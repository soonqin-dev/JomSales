# 密码最低长度调整

按负责人要求：注册、密码修改、密码重置最低 6 个字符，最大 128，允许更长；登录保留旧账号兼容，已有密码不修改。三个界面共用同一长度常量；平台 MFA、邮箱验证和更改密码／邮箱的身份确认不取消。

部署前在 Supabase Auth 的 Email／Password 安全设置中，将 Minimum password length 改为 6 并保存。保留邮箱验证、Secure Email Change、Secure Password Change／当前密码确认及平台 MFA 设置。此项是 Auth 配置，不使用 SQL 修改 `auth.users`，不重置任何已有密码。

与第七批分页／筛选提交一起推送部署；无需新 SQL 或环境变量。用测试账号确认 5 字符被拒绝、6 字符可注册或更改；密码不要发到聊天或截图。

安全：Supabase 官方不建议低于 8 位，应建议用户用更长密码、不重复使用密码。参考：https://supabase.com/docs/guides/auth/password-security 。
