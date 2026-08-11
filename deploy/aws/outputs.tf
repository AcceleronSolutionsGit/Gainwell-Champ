# ⚠️ REVIEW BEFORE APPLYING — reference implementation.
# Outputs consumed by the runbook steps in deploy/README-deploy.md.

output "ecr_repository_url" {
  description = "Push the image here (runbook §4): docker push <this>:<tag>"
  value       = aws_ecr_repository.app.repository_url
}

output "apprunner_service_url" {
  description = "Public HTTPS host of the app. Web console at https://<this>/, WhatsApp webhook at https://<this>/webhook/whatsapp."
  value       = aws_apprunner_service.main.service_url
}

output "rds_endpoint" {
  description = "PostgreSQL endpoint (host:port) — already baked into DATABASE_URL inside the app secret."
  value       = aws_db_instance.main.endpoint
}

output "app_secret_arn" {
  description = "Secrets Manager ARN holding the app's env vars — populate with put-secret-value (runbook §6)."
  value       = aws_secretsmanager_secret.app.arn
}

output "app_secret_name" {
  description = "Secret name — this is what the app's AWS_SECRETS_ID points at."
  value       = aws_secretsmanager_secret.app.name
}

output "nat_egress_ip" {
  description = "The app's single stable outbound IP — give this to DarwinBox for API allowlisting (arch §3.1, runbook §9)."
  value       = aws_eip.nat.public_ip
}

output "vpc_id" {
  description = "App VPC id (for attaching future resources, e.g. a bastion for DB maintenance)."
  value       = aws_vpc.main.id
}
