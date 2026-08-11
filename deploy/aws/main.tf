# ══════════════════════════════════════════════════════════════════════════════
# ⚠️  REVIEW BEFORE APPLYING — reference implementation
#
# Gainwell CHAMP · Spot Recognition Tool — AWS infrastructure (Terraform).
# This is a REFERENCE layout matching GEPL_CHAMP_Tool_Architecture.docx. It
# is intended to be read, adapted to Gainwell's AWS landing zone (naming, tags,
# existing VPCs, SSO/IAM boundaries, CI/CD), costed, and only then applied.
#
# What it builds (all in ap-south-1 / Mumbai — DPDP data residency, arch §6):
#   ECR repository → container images (deploy/Dockerfile)
#   Small VPC       → 2 public + 2 private subnets, single NAT gateway
#   App Runner      → runs the container, HTTPS out of the box, VPC egress
#   RDS PostgreSQL  → encrypted, private subnets only (arch §6)
#   Secrets Manager → one JSON secret = the app's sensitive env vars (arch §3.5)
#   IAM roles       → ECR pull (build) + secret-read & SES-send (runtime)
#
# Runbook with the exact apply order + post-apply steps: deploy/README-deploy.md
# ══════════════════════════════════════════════════════════════════════════════

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  # PRODUCTION: keep state remote and locked (adapt to your landing zone):
  # backend "s3" {
  #   bucket         = "gainwell-terraform-state"
  #   key            = "champ-spot-tool/production.tfstate"
  #   region         = "ap-south-1"
  #   dynamodb_table = "terraform-locks"
  # }
}

# All resources pinned to ap-south-1 (Mumbai): recognition text and employee
# personal data (names, mobiles) stay in India — DPDP residency, arch §6.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ── ECR — container registry ──────────────────────────────────────────────────
# Images are built from deploy/Dockerfile and pushed here (README-deploy §4).
resource "aws_ecr_repository" "app" {
  name                 = var.project
  image_tag_mutability = "MUTABLE" # switch to IMMUTABLE once CI stamps unique tags

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# Keep the registry tidy: retain the last 10 images.
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# ── VPC — private network for RDS + App Runner egress ────────────────────────
# RDS must be unreachable from the internet (arch §6); App Runner reaches it
# through a VPC connector into the private subnets. Outbound internet traffic
# (Meta WhatsApp Cloud API, DarwinBox) leaves via ONE NAT gateway, giving a
# single stable egress IP — hand that IP to DarwinBox for allowlisting
# (arch §3.1; see outputs.tf `nat_egress_ip`).
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.project}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project}-igw" }
}

resource "aws_subnet" "public" {
  count                   = length(var.availability_zones)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index) # .0.x, .16.x
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.project}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 8) # .128.x, .144.x
  availability_zone = var.availability_zones[count.index]
  tags              = { Name = "${var.project}-private-${count.index}" }
}

# Single NAT gateway: ~USD 35/month + data. Fine for this workload; add one
# per AZ only if NAT AZ-failure downtime is unacceptable.
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.project}-nat-eip" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "${var.project}-nat" }
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.project}-public-rt" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = { Name = "${var.project}-private-rt" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# ── Security groups ───────────────────────────────────────────────────────────
# App Runner's VPC connector attaches this SG; only IT flows out of it.
resource "aws_security_group" "apprunner_connector" {
  name_prefix = "${var.project}-apprunner-"
  description = "App Runner VPC connector egress"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# The database accepts 5432 ONLY from the App Runner connector SG — nothing
# else, not even other VPC members (arch §6: least-access to personal data).
resource "aws_security_group" "rds" {
  name_prefix = "${var.project}-rds-"
  description = "RDS PostgreSQL - app access only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from App Runner connector"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.apprunner_connector.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ── RDS PostgreSQL — arch §6 (DPDP: encrypted at rest, private, in-region) ───
resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-${var.environment}"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class # db.t4g.micro — right-sized for ≤ a few hundred users

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password # sensitive var; ALTERNATIVE: manage_master_user_password = true
                             # lets RDS keep the master password in its own Secrets Manager
                             # secret with rotation — then compose DATABASE_URL from that.

  allocated_storage     = 20
  max_allocated_storage = 50   # autoscaling headroom
  storage_type          = "gp3"
  storage_encrypted     = true # DPDP / arch §6 — encryption at rest (default KMS key)

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false # private subnets only (arch §6)
  multi_az               = var.db_multi_az

  backup_retention_period = 7
  deletion_protection     = true
  skip_final_snapshot     = false
  final_snapshot_identifier = "${var.project}-${var.environment}-final"

  performance_insights_enabled = false # enable if you outgrow t4g.micro
}

# ── Secrets Manager — the secrets vault (arch §3.5) ──────────────────────────
# ONE JSON secret holds every sensitive env var. The app loads it at boot via
# server/src/aws/secretsManager.ts (AWS_SECRETS_ENABLED=true) and then rebuilds
# its config — no secret ever lives in the image, task definition, or .env.
resource "aws_secretsmanager_secret" "app" {
  name        = var.secret_name # e.g. champ-spot-tool/production
  description = "CHAMP Spot Tool - application secrets (loaded at boot by the app)"
}

# Initial skeleton so the app boots; REAL values (WhatsApp token, SMTP…) are
# populated afterwards with `aws secretsmanager put-secret-value` (runbook §6).
# ignore_changes keeps Terraform from clobbering operator-rotated values.
resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    # Database — composed from the RDS instance created above.
    DATABASE_CLIENT = "pg"
    DATABASE_URL    = "postgres://${var.db_username}:${var.db_password}@${aws_db_instance.main.address}:5432/${var.db_name}"

    # Web console session signing (app refuses to boot without it in prod).
    SESSION_SECRET = var.session_secret

    # Email — SES via the instance role, no keys needed (arch §3.3).
    EMAIL_PROVIDER = "ses"
    EMAIL_FROM     = var.email_from

    # WhatsApp Business Platform — fill in after Meta onboarding (runbook §2a, §8).
    # Until then the placeholders keep the provider in simulator mode so a
    # freshly applied stack boots cleanly.
    WHATSAPP_PROVIDER       = "simulator" # flip to "meta" once credentials are in
    META_WA_API_VERSION     = "v20.0"
    META_WA_PHONE_NUMBER_ID = ""
    META_WA_TOKEN           = ""
    META_WA_APP_SECRET      = ""
    META_WA_VERIFY_TOKEN    = ""

    # DarwinBox HRIS sync — fill in after credentials + IP allowlisting.
    DARWINBOX_ENABLED       = "false"
    DARWINBOX_BASE_URL      = ""
    DARWINBOX_API_KEY       = ""
    DARWINBOX_CLIENT_ID     = ""
    DARWINBOX_CLIENT_SECRET = ""
    DARWINBOX_DATASET_ID    = ""

    # Optional kiosk-board token (root README - Plant board).
    BOARD_TOKEN = ""
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── IAM — build-time ECR pull + runtime secret-read & SES-send ───────────────
# Role 1: App Runner's BUILD principal pulls the image from ECR.
data "aws_iam_policy_document" "apprunner_build_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["build.apprunner.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "apprunner_ecr_access" {
  name               = "${var.project}-apprunner-ecr-access"
  assume_role_policy = data.aws_iam_policy_document.apprunner_build_assume.json
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr_access" {
  role       = aws_iam_role.apprunner_ecr_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

# Role 2: the RUNNING container. Grants exactly two things:
#   - read THE app secret (arch §3.5 — secretsManager.ts loader)
#   - send email through SES (OTP login mail, arch §3.3/§3.4)
data "aws_iam_policy_document" "apprunner_instance_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["tasks.apprunner.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "apprunner_instance" {
  name               = "${var.project}-apprunner-instance"
  assume_role_policy = data.aws_iam_policy_document.apprunner_instance_assume.json
}

data "aws_iam_policy_document" "apprunner_runtime" {
  statement {
    sid       = "ReadAppSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }

  statement {
    sid     = "SendOtpAndDigestMail"
    actions = ["ses:SendEmail", "ses:SendRawEmail"]
    # Tighten to the verified identity ARN once SES setup is done (runbook §7):
    # resources = ["arn:aws:ses:${var.aws_region}:<account>:identity/${var.email_from_domain}"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "apprunner_runtime" {
  name   = "${var.project}-runtime"
  role   = aws_iam_role.apprunner_instance.id
  policy = data.aws_iam_policy_document.apprunner_runtime.json
}

# ── App Runner — the application service ─────────────────────────────────────
# Chosen over ECS/Fargate for this workload: managed HTTPS endpoint, built-in
# health-checked deploys, scale-to-few, no ALB to run (the app is a single
# container serving API + web console + webhook).
#
# ECS/FARGATE ALTERNATIVE — if Gainwell standardises on ECS, replace this and
# the VPC connector with:
#   aws_ecs_cluster + aws_ecs_task_definition (image, port 8080,
#     executionRoleArn = ECR-pull/log role, taskRoleArn = apprunner_instance
#     equivalent) + aws_ecs_service (Fargate, private subnets)
#   + aws_lb (ALB in the public subnets) + target group (health check
#     /api/health) + ACM certificate for the HTTPS listener.
# The container, IAM permissions, secret and RDS wiring stay identical.
resource "aws_apprunner_vpc_connector" "main" {
  vpc_connector_name = "${var.project}-connector"
  subnets            = aws_subnet.private[*].id
  security_groups    = [aws_security_group.apprunner_connector.id]
}

resource "aws_apprunner_service" "main" {
  service_name = "${var.project}-${var.environment}"

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr_access.arn
    }

    image_repository {
      image_repository_type = "ECR"
      image_identifier      = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"

      image_configuration {
        port = "8080"

        # Only NON-secret values here. Everything sensitive arrives via
        # secretsManager.ts at boot (arch §3.5) — the two AWS_SECRETS_* vars
        # below are the pointer that turns that loader on.
        runtime_environment_variables = {
          NODE_ENV           = "production"
          PORT               = "8080"
          AWS_REGION         = var.aws_region
          AWS_SECRETS_ENABLED = "true"
          AWS_SECRETS_ID      = aws_secretsmanager_secret.app.name
        }
      }
    }

    auto_deployments_enabled = false # deploys are explicit: push tag, then update (runbook §10)
  }

  instance_configuration {
    cpu               = var.apprunner_cpu
    memory            = var.apprunner_memory
    instance_role_arn = aws_iam_role.apprunner_instance.arn
  }

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/api/health"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 3
  }

  network_configuration {
    egress_configuration {
      # All outbound traffic goes through the VPC (→ NAT), giving the single
      # stable egress IP DarwinBox needs to allowlist (arch §3.1).
      egress_type       = "VPC"
      vpc_connector_arn = aws_apprunner_vpc_connector.main.arn
    }
  }
}
