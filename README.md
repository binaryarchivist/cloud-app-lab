# Getting Started

### Running the Application

```
npm install
```

```
npm run dev
```

Open [http://localhost:8080](http://localhost:8080) in your browser.


### Requirements

1. This project should be made to run as a Docker image.
Done:
    1. Enable Artifact Registry API in Google Console
    2. Enable Kubernetes Engine API
    3. Enable Compute Engine API

2. Docker image should be published to a Docker registry.
First created an Autopilot cluster that will auto scale later
Created A service account with the roles: Artifact Registry Writer and Kubernetes Engine Developer.

Then created an Workload identity pool for it and added the service account created earlier to it.

Next would be binding the github repo to the service account:
```
gcloud iam service-accounts add-iam-policy-binding   github-actions@cloud-lab-work-497422.iam.gserviceaccount.com   --role="roles/iam.workloadIdentityUser"   --member="principalSet://iam.googleapis.com/projects/108578924779/locations/global/workloadIdentityPools/github-pool/attribute.repository/binaryarchivist/cloud-app-lab"
```


Now we'd need an Artifact repository:

```
gcloud artifacts repositories create myapp \
  --repository-format=docker \
  --location=europe-west1 \
  --description="My app docker images"
  ```


Before writing the github workflow we need to write the manifests to be deployed first, so there were created initially from the k8s/ folder.


After it was successfully created, we'd need to create a github workflow:

```
name: Build and Deploy to GKE

on:
push:
branches:
    - main

env:
PROJECT_ID: cloud-lab-work-497422
REGION: europe-west1
REPOSITORY: myapp
IMAGE: myapp
CLUSTER_NAME: myapp-cluster

jobs:
build-and-deploy:
runs-on: ubuntu-latest

permissions:
    contents: read
    id-token: write  # required for Workload Identity Federation

steps:
    - name: Checkout code
    uses: actions/checkout@v4

    - name: Authenticate to Google Cloud
    uses: google-github-actions/auth@v2
    with:
        workload_identity_provider: projects/108578924779/locations/global/workloadIdentityPools/github-pool/providers/github-provider
        service_account: github-actions@cloud-lab-work-497422.iam.gserviceaccount.com

    - name: Set up Cloud SDK
    uses: google-github-actions/setup-gcloud@v2

    - name: Configure Docker for Artifact Registry
    run: gcloud auth configure-docker europe-west1-docker.pkg.dev --quiet

    - name: Build Docker image
    run: |
        docker build -t europe-west1-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE }}:${{ github.sha }} .

    - name: Push Docker image
    run: |
        docker push europe-west1-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE }}:${{ github.sha }}

    - name: Get GKE credentials
    run: |
        gcloud container clusters get-credentials ${{ env.CLUSTER_NAME }} \
        --region ${{ env.REGION }} \
        --project ${{ env.PROJECT_ID }}

    - name: Deploy to GKE
    run: |
        kubectl set image deployment/myapp \
        myapp=europe-west1-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE }}:${{ github.sha }}
        kubectl rollout status deployment/myapp
        ```

3. Docker image should be deployed to a Kubernetes cluster.
4. Kubernetes cluster should be running on a cloud provider.
5. Kubernetes cluster should be accessible from the internet.
6. Kubernetes cluster should be able to scale the application.
7. Kubernetes cluster should be able to update the application without downtime.
8. Kubernetes cluster should be able to rollback the application to a previous version.
9. Kubernetes cluster should be able to monitor the application.
10. Kubernetes cluster should be able to autoscale the application based on the load.
12. Application logs should be stored in a centralised logging system (Loki, Kibana, etc.)
12. Application should be able to send metrics to a monitoring system.
13. Database should be running on a separate container.
14. Storage should be mounted to the database container.
