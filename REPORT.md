# Cloud App Lab — GKE Kubernetes Deployment

A production-grade Node.js/Express + TypeScript application deployed to Google Kubernetes Engine (GKE) with full CI/CD, monitoring, logging, autoscaling, and a managed PostgreSQL database.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Requirements Checklist](#requirements-checklist)
3. [Project Structure](#project-structure)
4. [Requirement 1 — Docker Image](#requirement-1--docker-image)
5. [Requirement 2 — Container Registry](#requirement-2--container-registry)
6. [Requirement 3 — GKE Deployment](#requirement-3--gke-deployment)
7. [Requirement 4 — Cloud Provider](#requirement-4--cloud-provider)
8. [Requirement 5 — Internet Accessibility](#requirement-5--internet-accessibility)
9. [Requirement 6 — Scaling](#requirement-6--scaling)
10. [Requirement 7 — Zero Downtime Updates](#requirement-7--zero-downtime-updates)
11. [Requirement 8 — Rollbacks](#requirement-8--rollbacks)
12. [Requirement 9 & 12 — Monitoring & Metrics](#requirement-9--12--monitoring--metrics)
13. [Requirement 10 — Autoscaling](#requirement-10--autoscaling)
14. [Requirement 11 — Centralised Logging](#requirement-11--centralised-logging)
15. [Requirement 13 & 14 — Database with Persistent Storage](#requirement-13--14--database-with-persistent-storage)
16. [CI/CD Pipeline](#cicd-pipeline)
17. [How to Test Everything](#how-to-test-everything)

---

## Architecture Overview

```
Developer → GitHub → GitHub Actions CI/CD
                          │
                          ├── Build Docker image
                          ├── Push to Google Artifact Registry
                          └── Deploy to GKE
                                    │
                         ┌──────────┴──────────┐
                         │    GKE Cluster       │
                         │                      │
                         │  ┌────────────────┐  │
                         │  │ Ingress /       │  │
                         │  │ LoadBalancer    │  │
                         │  └───────┬────────┘  │
                         │          │            │
                         │  ┌───────▼────────┐  │
                         │  │ App Deployment │  │
                         │  │ (2-10 replicas)│  │
                         │  └───────┬────────┘  │
                         │          │            │
                         │  ┌───────▼────────┐  │
                         │  │  PostgreSQL     │  │
                         │  │  StatefulSet    │  │
                         │  │  + PVC (10Gi)   │  │
                         │  └────────────────┘  │
                         │                      │
                         │  ┌────────────────┐  │
                         │  │ monitoring ns   │  │
                         │  │ Prometheus      │  │
                         │  │ Grafana         │  │
                         │  │ Loki + Alloy    │  │
                         │  └────────────────┘  │
                         └──────────────────────┘
```

---

## Requirements Checklist

| # | Requirement | Solution | Status |
|---|---|---|---|
| 1 | Docker image | Multi-stage Dockerfile | ✅ |
| 2 | Published to registry | Google Artifact Registry | ✅ |
| 3 | Deployed to Kubernetes | GKE Autopilot | ✅ |
| 4 | Cloud provider | Google Cloud Platform | ✅ |
| 5 | Internet accessible | GCP Ingress + LoadBalancer | ✅ |
| 6 | Scalable | Multiple replicas | ✅ |
| 7 | Zero downtime updates | RollingUpdate strategy | ✅ |
| 8 | Rollback | kubectl rollout undo | ✅ |
| 9 | Monitoring | Prometheus + Grafana | ✅ |
| 10 | Autoscaling | HorizontalPodAutoscaler | ✅ |
| 11 | Centralised logging | Loki + Grafana Alloy | ✅ |
| 12 | Metrics | prom-client /metrics endpoint | ✅ |
| 13 | DB separate container | PostgreSQL StatefulSet | ✅ |
| 14 | DB storage mounted | PersistentVolumeClaim (10Gi) | ✅ |

---

## Project Structure

```
cloud-app-lab/
├── .github/
│   └── workflows/
│       └── deploy.yml              # CI/CD pipeline
├── k8s/
│   ├── monitoring/
│   │   ├── prometheus.yml         # Prometheus deployment
│   │   ├── grafana.yml            # Grafana deployment
│   │   └── loki-values.yml        # Loki helm values
│   ├── deployment.yml             # App deployment
│   ├── service.yml                # App service
│   ├── ingress.yml                # Ingress / LoadBalancer
│   ├── hpa.yml                    # HorizontalPodAutoscaler
│   ├── postgres-secret.yml        # DB credentials secret
│   ├── postgres.yml               # PostgreSQL StatefulSet + PVC
│   └── service-monitor.yml         # Prometheus scrape config
├── src/
│   ├── index.ts                    # Express app entry point
│   └── db.ts                       # PostgreSQL connection pool
├── Dockerfile                      # Multi-stage Docker build
├── docker-compose.yml              # Local development
├── package.json
├── package-lock.json
└── tsconfig.json
```

---

## Requirement 1 — Docker Image

### Why
The application needs to be packaged as a Docker image so it can run consistently across any environment: local, CI, and Kubernetes.

### Implementation

A multi-stage `Dockerfile` is used to keep the final image small:
- **Stage 1 (builder)**: Installs all dependencies and compiles TypeScript to JavaScript
- **Stage 2 (runtime)**: Copies only the compiled output and production dependencies

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

`npm ci` is used instead of `npm install` because it uses the lockfile exactly, making builds reproducible and faster.

### Application

The Express app (`src/index.ts`) exposes three endpoints:

```typescript
app.get("/", (_req, res) => res.send("Hello world"));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", db: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", db: err.message });
  }
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.send(await register.metrics());
});
```

### Local Development

```bash
docker compose up --build
```

Test locally:
```bash
curl http://localhost:3000/health
# {"status":"ok","db":"connected"}
```

---

## Requirement 2 — Container Registry

### Why
The GKE cluster needs to pull the Docker image from somewhere. Google Artifact Registry (GAR) is used because it lives in the same GCP project as the cluster, making authentication seamless with no extra credentials needed.

### Setup

Enable the API:
```bash
gcloud services enable artifactregistry.googleapis.com
```

Create the repository:
```bash
gcloud artifacts repositories create myapp \
  --repository-format=docker \
  --location=europe-west1 \
  --description="My app docker images"
```

Authenticate Docker:
```bash
gcloud auth configure-docker europe-west1-docker.pkg.dev
```

Build and push manually (first time only):
```bash
docker build -t europe-west1-docker.pkg.dev/cloud-lab-work-497422/myapp/myapp:v1 .
docker push europe-west1-docker.pkg.dev/cloud-lab-work-497422/myapp/myapp:v1
```

Verify:
```bash
gcloud artifacts docker images list europe-west1-docker.pkg.dev/cloud-lab-work-497422/myapp
```

Grant GKE nodes permission to pull images:
```bash
gcloud projects add-iam-policy-binding cloud-lab-work-497422 \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/artifactregistry.reader"
```

Without this IAM binding, pods fail with `ImagePullBackOff` — the node service account can't authenticate to pull the image.

---

## Requirement 3 — GKE Deployment

### Why
GKE Autopilot is used because it automatically manages node provisioning, scaling, and security. You only pay for pod resources, not idle nodes.

### Cluster Creation

Created via GCP Console: **Kubernetes Engine → Clusters → Create → Autopilot**

Connect kubectl to the cluster:
```bash
gcloud container clusters get-credentials myapp-cluster \
  --region europe-west1 \
  --project cloud-lab-work-497422
```

Verify connection:
```bash
kubectl config current-context
kubectl get nodes  # may be empty on Autopilot until first deploy
```

### Apply Manifests

```bash
kubectl apply -f k8s/
```

This creates all resources: Deployment, Services, Ingress, HPA, PostgreSQL StatefulSet, PVC, and Secret.

---

## Requirement 4 — Cloud Provider

### Why
Google Cloud Platform (GCP) is used. GKE Autopilot is GCP's managed Kubernetes service — it handles the control plane, node provisioning, security patching, and scaling automatically.

APIs enabled:
```bash
gcloud services enable \
  artifactregistry.googleapis.com \
  container.googleapis.com \
  compute.googleapis.com
```

---

## Requirement 5 — Internet Accessibility

### Why
The app needs to be reachable from the internet. A Kubernetes Ingress resource backed by a GCP HTTP(S) Load Balancer provides this. The Ingress gets a public IP automatically.

### Implementation

`k8s/ingress.yaml`:
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  annotations:
    kubernetes.io/ingress.class: "gce"
spec:
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp-service
                port:
                  number: 80
```

Get the external IP:
```bash
kubectl get ingress
```

### How to Test

```bash
curl http://EXTERNAL_IP/
# Hello world
# EXTERNAL_IP = 34.22.254.81

curl http://EXTERNAL_IP/health
# {"status":"ok","db":"connected"}
```

---

## Requirement 6 — Scaling

### Why
Running multiple replicas ensures the app can handle more traffic and provides redundancy — if one pod crashes, others continue serving requests.

The Deployment runs 2 replicas by default:

```yaml
spec:
  replicas: 2
```

Manually scale:
```bash
kubectl scale deployment myapp --replicas=5
kubectl get pods  # see 5 pods running
```

---

## Requirement 7 — Zero Downtime Updates

### Why
A `RollingUpdate` strategy ensures new pods are started before old ones are terminated. `maxUnavailable: 0` guarantees no requests are dropped during a deploy.

### Implementation

`k8s/deployment.yaml`:
```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1        # spin up 1 extra pod during update
    maxUnavailable: 0  # never kill a pod before new one is ready
```

Readiness and liveness probes ensure Kubernetes only routes traffic to healthy pods:

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 15
  periodSeconds: 20
```

### How to Test

Push a new commit to `main` — GitHub Actions runs the deploy. Watch the rollout:
```bash
kubectl rollout status deployment/myapp
```

During the rollout, repeatedly curl the app — it should never return an error:
```bash
# http://34.110.157.222/
while true; do curl -s http://EXTERNAL_IP/health; sleep 1; done
```

---

## Requirement 8 — Rollbacks

### Why
If a bad deploy goes out, you need to quickly revert to the previous working version without rebuilding anything.

### How to Rollback

```bash
# View rollout history
kubectl rollout history deployment/myapp

# Rollback to previous version
kubectl rollout undo deployment/myapp

# Rollback to a specific revision
kubectl rollout undo deployment/myapp --to-revision=2

# Verify rollback completed
kubectl rollout status deployment/myapp
```

Each deploy is tagged with the Git commit SHA (`github.sha`), so every image version is uniquely identifiable and recoverable.

---

## Requirement 9 & 12 — Monitoring & Metrics

### Why
Prometheus scrapes metrics from the app's `/metrics` endpoint. Grafana visualises them. The `prom-client` library automatically exposes Node.js runtime metrics (CPU, memory, event loop lag, HTTP request durations).

### App Metrics

`src/index.ts`:
```typescript
import { collectDefaultMetrics, register } from "prom-client";

collectDefaultMetrics(); // auto-collects Node.js runtime metrics

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.send(await register.metrics());
});
```

### Prometheus Deployment

`k8s/monitoring/prometheus.yaml` — scrapes the app every 15 seconds:
```yaml
scrape_configs:
  - job_name: 'myapp'
    static_configs:
      - targets: ['myapp-service.default.svc.cluster.local:80']
    metrics_path: /metrics
```

Deploy:
```bash
kubectl apply -f k8s/monitoring/prometheus.yaml
kubectl apply -f k8s/monitoring/grafana.yaml
```

Expose Grafana externally:
```bash
kubectl patch svc grafana -n monitoring -p '{"spec": {"type": "LoadBalancer"}}'
kubectl get svc grafana -n monitoring  # get external IP
```

Access Grafana at `http://GRAFANA_IP:3000` with `admin/admin123`.

### How to Test

```bash
curl http://EXTERNAL_IP/metrics
# HELP nodejs_eventloop_lag_seconds ...
# TYPE nodejs_eventloop_lag_seconds gauge
# nodejs_eventloop_lag_seconds 0.001234
```

In Grafana: **Explore → Prometheus** → query `nodejs_eventloop_lag_seconds`

---

## Requirement 10 — Autoscaling

### Why
The HorizontalPodAutoscaler (HPA) automatically increases the number of pods when CPU or memory usage is high, and scales back down when load decreases. This handles traffic spikes without manual intervention.

### Implementation

`k8s/hpa.yaml`:
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

### How to Test

```bash
# Watch HPA in real time
kubectl get hpa -w

# Check current status
kubectl describe hpa myapp-hpa
```

To simulate load and trigger autoscaling:
```bash
kubectl run load-test --image=busybox --rm -it --restart=Never -- \
  sh -c "while true; do wget -q -O- http://myapp-service/; done"
```

Watch the replica count increase in another terminal:
```bash
kubectl get pods -w
```

---

## Requirement 11 — Centralised Logging

### Why
All pod logs need to be collected in one place so you can search across all replicas and see historical logs even after a pod is restarted or deleted. Loki stores the logs and Grafana Alloy collects them from all pods automatically as a DaemonSet.

### Why Grafana Alloy instead of Promtail
GKE Autopilot restricts hostPath volumes — Promtail requires access to `/var/lib/docker/containers` and `/proc` which are blocked. Grafana Alloy uses the Kubernetes API to collect logs from `/var/log/pods/` which is allowed.

### Install Loki

```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

helm upgrade --install loki-stack grafana/loki-stack \
  --namespace monitoring \
  --create-namespace \
  --values k8s/monitoring/loki-values.yaml \
  --wait
```

### Install Grafana Alloy

```bash
helm upgrade --install alloy grafana/alloy \
  --namespace monitoring \
  --set alloy.configMap.content='
loki.source.kubernetes "pods" {
  targets    = discovery.relabel.pods.output
  forward_to = [loki.write.default.receiver]
}
loki.write "default" {
  endpoint {
    url = "http://loki-stack:3100/loki/api/v1/push"
  }
}'
```

### Add Loki to Grafana

In Grafana UI: **Connections → Data Sources → Add → Loki**
- URL: `http://loki-stack:3100`
- Save & Test

### How to Test

In Grafana: **Explore → Loki** → select label `namespace = default` → run query.

You should see logs from all your app pods in real time.

---

## Requirement 13 & 14 — Database with Persistent Storage

### Why
The database must run in a separate container (not bundled with the app) and have its data persisted to disk. A Kubernetes StatefulSet is used for PostgreSQL because it provides stable network identity and ordered deployment. A PersistentVolumeClaim (PVC) automatically provisions a GCP disk that survives pod restarts.

### Key Fix — subPath
GCP disks are formatted with `ext4` which creates a `lost+found` directory at the mount root. PostgreSQL refuses to initialise in a non-empty directory. The `subPath: pgdata` setting makes postgres write into a subdirectory of the mount, avoiding the conflict:

```yaml
volumeMounts:
  - name: postgres-storage
    mountPath: /var/lib/postgresql/data
    subPath: pgdata  # critical — avoids lost+found conflict
```

### Implementation

`k8s/postgres.yaml`:
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres-service
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:15
          env:
            - name: POSTGRES_DB
              valueFrom:
                secretKeyRef:
                  name: postgres-secret
                  key: db-name
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: postgres-secret
                  key: db-user
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-secret
                  key: db-password
          volumeMounts:
            - name: postgres-storage
              mountPath: /var/lib/postgresql/data
              subPath: pgdata
      volumes:
        - name: postgres-storage
          persistentVolumeClaim:
            claimName: postgres-pvc
```

The database is only exposed internally via `ClusterIP` — never to the internet.

### How to Test

```bash
# Verify PVC is bound
kubectl get pvc

# Verify postgres is running
kubectl get pods | grep postgres

# Test DB connection through the app
curl http://EXTERNAL_IP/health
# {"status":"ok","db":"connected"}

# Test directly with a query
curl http://EXTERNAL_IP/test-db
# {"time":"2026-05-26T..."}
```

---

## CI/CD Pipeline

### Why Workload Identity Federation instead of Service Account Keys
GCP org policy blocked service account key creation. Workload Identity Federation allows GitHub Actions to authenticate to GCP using short-lived OIDC tokens instead — more secure and no keys to manage or rotate.

### Setup

1. Create service account:
   - **IAM & Admin → Service Accounts → Create**
   - Name: `github-actions`
   - Roles: `Artifact Registry Writer`, `Kubernetes Engine Developer`

2. Create Workload Identity Pool:
   - **IAM & Admin → Workload Identity Federation → Create Pool**
   - Provider: `OpenID Connect (OIDC)`
   - Issuer: `https://token.actions.githubusercontent.com`

3. Bind to GitHub repo:
```bash
gcloud iam service-accounts add-iam-policy-binding \
  github-actions@cloud-lab-work-497422.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/108578924779/locations/global/workloadIdentityPools/github-pool/attribute.repository/binaryarchivist/cloud-app-lab"
```

### Pipeline (`.github/workflows/deploy.yml`)

On every push to `main`:

1. Authenticates to GCP via Workload Identity (no keys)
2. Installs `gke-gcloud-auth-plugin`
3. Builds Docker image tagged with Git commit SHA
4. Pushes to Artifact Registry
5. Gets GKE credentials
6. Installs/upgrades Helm monitoring stack
7. Applies Kubernetes manifests
8. Updates deployment image
9. Waits for rollout to complete (`kubectl rollout status`)

```yaml
- name: Deploy to GKE
  run: |
    kubectl apply -f k8s/
    kubectl set image deployment/myapp \
      myapp=europe-west1-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE }}:${{ github.sha }}
    kubectl rollout status deployment/myapp
```

Using `github.sha` as the image tag means every deploy is uniquely versioned and any version can be rolled back to.

---

## How to Test Everything

### 1 — App is running

```bash
curl http://EXTERNAL_IP/
# Hello world
# 34.110.157.222
curl http://EXTERNAL_IP/health
# {"status":"ok","db":"connected"}
```

### 2 — Metrics are exposed

```bash
curl http://EXTERNAL_IP/metrics
# nodejs_eventloop_lag_seconds ...
```

### 3 — Zero downtime deploy

Push a change to `main`, then while it deploys:
```bash
while true; do curl -s -o /dev/null -w "%{http_code}\n" http://EXTERNAL_IP/health; sleep 0.5; done
# should always return 200
```

### 4 — Rollback works

```bash
kubectl rollout history deployment/myapp
kubectl rollout undo deployment/myapp
kubectl rollout status deployment/myapp
```

### 5 — Autoscaling works

```bash
kubectl get hpa myapp-hpa
# watch TARGETS column — scale up when CPU > 70%

kubectl run load-test --image=busybox --rm -it --restart=Never -- \
  sh -c "while true; do wget -q -O- http://myapp-service/; done"

kubectl get pods -w
# replica count increases automatically
```

### 6 — Database persistence works

```bash
# exec into postgres pod
kubectl exec -it postgres-0 -- psql -U myappuser -d myappdb

# create a table and insert data
CREATE TABLE test (id SERIAL, val TEXT);
INSERT INTO test (val) VALUES ('hello');
SELECT * FROM test;

# delete and restart the pod
kubectl delete pod postgres-0

# pod restarts, exec again
kubectl exec -it postgres-0 -- psql -U myappuser -d myappdb
SELECT * FROM test;
# data is still there — PVC persisted it
```

### 7 — Logs in Grafana

1. Open `http://GRAFANA_IP:3000`
2. Login: `admin / admin123`
3. Go to **Explore → Loki**
4. Select label `namespace = default`
5. Run query — see live logs from all app pods

### 8 — Metrics in Grafana

1. Go to **Explore → Prometheus**
2. Query: `nodejs_eventloop_lag_seconds`
3. Should show a graph of Node.js event loop metrics

---

## Content
svc grafana - 34.22.254.81
ingress - 34.110.157.222

## Common Issues & Fixes

| Issue | Cause | Fix |
|---|---|---|
| `ImagePullBackOff` | Node SA missing GAR reader role | Add `roles/artifactregistry.reader` to compute SA |
| `CrashLoopBackOff` on postgres | `lost+found` in mount root | Add `subPath: pgdata` to volumeMount |
| Helm chart fails on Autopilot | kube-system namespace restricted | Disable `kubeProxy`, `coreDns`, `nodeExporter` in values |
| Grafana datasource error | Version mismatch with Loki | Use `grafana/grafana:9.5.20` |
| `gke-gcloud-auth-plugin not found` | Missing plugin in CI runner | Add `install_components: gke-gcloud-auth-plugin` to setup-gcloud action |
| Pods `Pending` on Autopilot | Nodes provisioning on demand | Wait 2-3 minutes, Autopilot provisions nodes automatically |