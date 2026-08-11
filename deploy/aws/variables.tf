# ⚠️ REVIEW BEFORE APPLYING — reference implementation.
# Inputs for the CHAMP Spot Tool AWS stack (see main.tf). Sensitive values are
# passed at apply time (TF_VAR_… env vars or a git-ignored .tfvars file) —
# never commit them.

variable "aws_region" {
  description = "AWS region. Keep ap-south-1 (Mumbai) for DPDP data residency (arch §6)."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Resource name prefix."
  type        = string
  default     = "champ-spot-tool"
}

variable "environment" {
  description = "Deployment environment (arch §7 recommends dev / staging / prod stacks, one .tfvars each)."
  type        = string
  default     = "production"
}

variable "image_tag" {
  description = "ECR image tag App Runner should run (push the image first — runbook §3)."
  type        = string
  default     = "latest"
}

# ── Network ───────────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR for the app VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "availability_zones" {
  description = "Two AZs for the subnet pairs (RDS subnet groups need >= 2)."
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b"]
}

# ── Database (RDS PostgreSQL) ─────────────────────────────────────────────────

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro comfortably serves this workload's scale."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "PostgreSQL major version."
  type        = string
  default     = "16"
}

variable "db_name" {
  description = "Database name."
  type        = string
  default     = "champ"
}

variable "db_username" {
  description = "Database master username."
  type        = string
  default     = "champ"
}

variable "db_password" {
  description = "Database master password. Set via TF_VAR_db_password — never commit. (Alternative: manage_master_user_password on the aws_db_instance.)"
  type        = string
  sensitive   = true
}

variable "db_multi_az" {
  description = "Multi-AZ standby for RDS. Off by default (cost); enable for prod if the availability budget requires it."
  type        = bool
  default     = false
}

# ── Application ───────────────────────────────────────────────────────────────

variable "session_secret" {
  description = "Session-cookie signing secret seeded into the app secret (generate: openssl rand -hex 32). Set via TF_VAR_session_secret."
  type        = string
  sensitive   = true
}

variable "email_from" {
  description = "From address for OTP / digest mail — must be an SES-verified identity (runbook §6)."
  type        = string
  default     = "no-reply@gainwellengineering.com"
}

variable "secret_name" {
  description = "Secrets Manager secret name the app reads at boot (AWS_SECRETS_ID)."
  type        = string
  default     = "champ-spot-tool/production"
}

variable "apprunner_cpu" {
  description = "App Runner vCPU units (1024 = 1 vCPU)."
  type        = string
  default     = "1024"
}

variable "apprunner_memory" {
  description = "App Runner memory in MB."
  type        = string
  default     = "2048"
}
