#!/bin/bash

# Build the Docker image
docker build -t medical-claim-processor .

# Authenticate with AWS ECR
aws ecr get-login-password --region your-region | docker login --username AWS --password-stdin your-account-id.dkr.ecr.your-region.amazonaws.com

# Tag and push the image
docker tag medical-claim-processor:latest your-account-id.dkr.ecr.your-region.amazonaws.com/medical-claim-processor:latest
docker push your-account-id.dkr.ecr.your-region.amazonaws.com/medical-claim-processor:latest

# Update ECS service
aws ecs update-service --cluster medical-claim-cluster --service medical-claim-service --force-new-deployment