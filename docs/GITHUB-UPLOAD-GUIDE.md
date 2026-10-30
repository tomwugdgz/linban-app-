# 上传到 GitHub · 完整步骤（本机验证通过）

> 适用：`D:/VC/linban-app` → `https://github.com/tomwugdgz/linban-app-`
> 验证日期：2026-10-30　实测：372 个文件 / 9 个提交 / SHA 双向一致

## 一、先诊断（别急着推）

```bash
cd /d/VC/linban-app

# 1) 直连 vs 代理，差 20 倍就摘代理
curl -s -o /dev/null -w "via-proxy: %{time_total}s\n" -x http://127.0.0.1:4780 https://api.github.com/
curl -s -o /dev/null -w "direct:    %{time_total}s\n" --noproxy '*' https://api.github.com/

# 2) Token 是否有效
TOKEN=$(sed -E 's#.*://[^:]*:([^@]+)@.*#\1#' ~/.git-credentials | head -1)
curl -s --noproxy '*' -H "Authorization: token $TOKEN" https://api.github.com/user | grep '"login"'

# 3) Token 权限（缺 workflow 就要走 SSH）
curl -s -D - -o /dev/null --noproxy '*' -H "Authorization: token $TOKEN" \
  https://api.github.com/user | grep -i x-oauth-scopes
# 期望看到：gist, read:org, repo   ← 没有 workflow

# 4) 单文件体积（找出该不该入库的大二进制）
git ls-tree -r -l HEAD | sort -k4 -rn | head -5
```

## 二、准备

```bash
# 摘掉慢代理 + 切 TLS 后端
git config --global --unset http.proxy
git config --global --unset https.proxy
git config http.sslBackend openssl

# 不该入库的产物加进 .gitignore 并从索引移除
printf '\n.swc/\n' >> .gitignore
git rm -r --cached apps/miniapp-user/.swc apps/miniapp-companion/.swc
git add .gitignore && git commit -m "chore: 忽略 .swc/ 编译缓存目录"
```

## 三、推送（普通文件走 HTTPS，逐提交小包）

```bash
G="git -c http.proxy= -c https.proxy= -c http.sslBackend=openssl \
   -c credential.helper=store -c http.postBuffer=524288000 -c http.version=HTTP/1.1"

# 逐个提交推，每次只传该提交的增量 pack
for c in $($G rev-list --reverse main); do
  ok=0
  for try in 1 2 3; do
    $G push origin "$c:refs/heads/main" && { ok=1; break; }
  done
  [ $ok -eq 0 ] && { echo "FAIL $c"; break; }
done
```

> ⚠️ ref 名必须写全：`<commit>:refs/heads/main`，只写 `main` 会报 `not a full refname`。

## 四、workflow 文件走 SSH 补刀

OAuth token 没有 `workflow` scope，`.github/workflows/*` 会被远端拒收。

```bash
# 1) SSH config 的 github.com 段去掉 ProxyCommand（改直连）
# 2) 验证
ssh -T git@github.com     # 期望：Hi tomwugdgz! You've successfully authenticated

# 3) 补刀
git add .github/workflows/ci.yml
git commit -m "ci: 新增 CI 门禁流水线"
NEW=$(git rev-parse HEAD)
git -c core.sshCommand="ssh -o StrictHostKeyChecking=no" \
    push git@github.com:tomwugdgz/linban-app-.git "$NEW:refs/heads/main"
```

## 五、核验（不能只看 push 输出）

```bash
# ref SHA 必须一致
L=$(git rev-parse HEAD)
R=$(git -c http.proxy= -c https.proxy= -c http.sslBackend=openssl \
     -c credential.helper=store ls-remote --heads origin main | awk '{print $1}')
[ "$L" = "$R" ] && echo "✅ 一致" || echo "❌ 不一致"

# 文件树逐个比对
git fetch origin main
diff <(git ls-tree -r FETCH_HEAD | awk '{print $4}' | sort) \
     <(git ls-tree -r main      | awk '{print $4}' | sort)
# 期望：无输出
```

## 六、报错速查

| 报错 | 原因 | 解法 |
|---|---|---|
| `curl 56 Recv failure: Connection was reset` | 代理慢链路，或 pack 过大 | 摘代理；逐提交推 |
| `remote rejected ... without 'workflow' scope` | OAuth token 缺 workflow scope | 该文件走 SSH |
| `403 Resource not accessible by integration` | GitHub App 也缺 workflows 权限 | 走 SSH |
| `The destination you provided is not a full refname` | ref 名没写全 | `<commit>:refs/heads/main` |
| `xargs: environment is too large for exec` | 沙箱 env 过大 | 用 `git add --pathspec-from-file=` |
| `Failed to connect to github.com:443 after 21000 ms` | 直连抖动 | 直接重试 |

> 完整版排障手册：`~/.workbuddy/skills/github-push-proxy-fix`（v2.4.0）
