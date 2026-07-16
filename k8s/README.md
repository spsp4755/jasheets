# JaSheets 폐쇄망 Kubernetes 배포 가이드

배포 흐름: **인터넷 PC에서 이미지 빌드 → podman save → 폐쇄망으로 tar 반입 →
podman load → 사내 Harbor에 push → k8s가 Harbor에서 pull**.
(레지스트리 없이 노드에 직접 `ctr import` 하는 방식이 아니라, Harbor를 거칩니다.)

## 구성

| 파일 | 내용 |
|---|---|
| `00-namespace.yaml` | `jasheets` 네임스페이스 |
| `10-postgres.yaml` | PostgreSQL 16 (Secret + PVC + Deployment + Service) |
| `20-api.yaml` | NestJS API (마이그레이션 initContainer 포함) |
| `30-web.yaml` | Next.js 프론트엔드 (standalone) |
| `40-ingress.yaml` | nginx Ingress — `/socket.io`, `/api` → api / 나머지 → web |
| `50-keycloak.yaml` | Keycloak SSO (선택) |

## 1. 이미지 빌드 (인터넷 가능한 PC에서)

```bash
podman build -f apps/api/Dockerfile -t jasheets/api:0.2.0 .
podman build -f apps/web/Dockerfile -t jasheets/web:0.2.0 .
podman pull docker.io/library/postgres:16-alpine
podman tag docker.io/library/postgres:16-alpine jasheets/postgres:16-alpine
podman pull quay.io/keycloak/keycloak:26.0        # Keycloak SSO 쓸 경우만
podman tag quay.io/keycloak/keycloak:26.0 jasheets/keycloak:26.0
```

## 2. tar로 저장 → 폐쇄망 반입 → podman load

```bash
# 인터넷 PC에서 저장
podman save -o jasheets-images-v0.2.0.tar.gz \
  jasheets/api:0.2.0 jasheets/web:0.2.0 jasheets/postgres:16-alpine jasheets/keycloak:26.0

# tar를 폐쇄망 반입 매체(USB 등)로 옮긴 뒤, 폐쇄망 안에서:
podman load -i jasheets-images-v0.2.0.tar.gz
```

## 3. 사내 Harbor로 push

```bash
# Harbor 로그인 (프로젝트 미리 생성해둘 것: jasheets)
podman login harbor.internal

# 실제 Harbor 주소로 태그 후 push (harbor.internal → 실제 값으로 변경)
for img in api:0.2.0 web:0.2.0 postgres:16-alpine keycloak:26.0; do
  podman tag jasheets/$img harbor.internal/jasheets/$img
  podman push harbor.internal/jasheets/$img
done
```

## 4. Harbor pull용 Secret 생성 (k8s 클러스터에서, 최초 1회)

```bash
kubectl create namespace jasheets
kubectl -n jasheets create secret docker-registry harbor-pull-secret \
  --docker-server=harbor.internal \
  --docker-username=<harbor계정> \
  --docker-password=<harbor비밀번호>
```

## 5. 매니페스트에서 반드시 수정

- 모든 `k8s/*.yaml`의 `image: harbor.internal/jasheets/...` → 실제 Harbor 주소/프로젝트로 일괄 변경
  (`sed -i 's#harbor.internal/jasheets#<실제주소>/jasheets#g' k8s/*.yaml` 로 한 번에 변경 가능)
- `10-postgres.yaml` → `POSTGRES_PASSWORD`
- `20-api.yaml` → `JWT_SECRET`, `DATABASE_URL`(비밀번호 동일하게), `CORS_ORIGIN`
- `40-ingress.yaml` → `host` (내부 DNS)

## 6. 배포

```bash
kubectl apply -f k8s/
kubectl -n jasheets get pods -w
```

initContainer가 `prisma migrate deploy` 로 테이블을 자동 생성합니다.

## 7. 초기 관리자 계정

```bash
kubectl -n jasheets exec deploy/api -- node dist/prisma/seed.js  # 시드 스크립트가 빌드에 포함된 경우
# 또는 회원가입 API 사용: POST /api/auth/register
```

## Keycloak SSO 설정 (50-keycloak.yaml)

### 배포 전 수정할 것

| 파일 | 항목 | 설명 |
|---|---|---|
| `50-keycloak.yaml` | `KEYCLOAK_ADMIN_PASSWORD` | Keycloak 관리 콘솔 비밀번호 |
| `50-keycloak.yaml` | `KC_DB_PASSWORD` | `10-postgres.yaml`의 `POSTGRES_PASSWORD`와 동일하게 |
| `50-keycloak.yaml` | `KC_HOSTNAME`, Ingress `host` | Keycloak 공개 주소 (내부 DNS) |
| `20-api.yaml` | `KEYCLOAK_URL` | 위 Keycloak 공개 주소와 동일하게 |
| `20-api.yaml` | `PUBLIC_APP_URL` | JaSheets 공개 주소 (`40-ingress.yaml`의 host) |
| `20-api.yaml` | `KEYCLOAK_CLIENT_SECRET` | 아래 3단계에서 발급받은 값 |

`keycloak:26.0` 이미지는 위 1~3단계에 이미 포함되어 있습니다 (Keycloak SSO를 쓰지 않으면 `50-keycloak.yaml`을 apply하지 않으면 됩니다).

### Keycloak 관리 콘솔에서 설정할 것 (최초 1회)

`http://keycloak.jasheets.local` 접속 → admin 로그인 후:

1. **Realm 생성**: 좌측 상단 드롭다운 → *Create realm* → Name: `jasheets`
2. **Client 생성**: *Clients → Create client*
   - Client type: `OpenID Connect`, Client ID: `jasheets` → Next
   - **Client authentication: ON** (confidential), Standard flow: ✔ → Next
   - **Valid redirect URIs**: `http://jasheets.local/api/auth/keycloak/callback`
   - Web origins: `http://jasheets.local` → Save
3. **클라이언트 시크릿 복사**: *Clients → jasheets → Credentials → Client Secret* 값을
   `20-api.yaml`의 `KEYCLOAK_CLIENT_SECRET`에 넣고 `kubectl apply -f k8s/20-api.yaml` 후 api 재시작
4. **사용자 생성**: *Users → Create new user* — **Email 필수 입력**
   (JaSheets는 email을 계정 키로 사용), *Credentials* 탭에서 비밀번호 설정
   - 사내 LDAP/AD가 있으면 *User federation*으로 연동하면 사용자 생성 생략 가능

동작: 로그인 페이지에 "Keycloak(SSO)으로 로그인" 버튼이 자동으로 나타나고,
최초 SSO 로그인 시 JaSheets에 사용자가 자동 생성됩니다. 기존 이메일/비밀번호 로그인도 병행 가능.

## 스케일링 주의

`api`는 Socket.IO 상태를 메모리에 두므로 **replicas: 1** 로 운영하세요.
수평 확장이 필요해지면 socket.io-redis-adapter + sticky session을 먼저 도입해야 합니다.
