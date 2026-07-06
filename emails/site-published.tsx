import * as React from "react";

type SitePublishedEmailProps = {
  userName?: string;
  siteName?: string;
  siteUrl?: string;
  dashboardUrl?: string;
  supportEmail?: string;
  deploymentId?: string;
};

const baseUrl = "https://app.985201314.xyz";

export default function SitePublishedEmail({
  userName = "你好",
  siteName = "你的轻巢站点",
  siteUrl = "https://demo.985201314.xyz",
  dashboardUrl = `${baseUrl}/dashboard`,
  supportEmail = "support@985201314.xyz",
  deploymentId
}: SitePublishedEmailProps) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{siteName} 已发布</title>
      </head>
      <body style={styles.body}>
        <span style={styles.preview}>你的 QingNest 站点已经发布成功，可以开始分享了。</span>
        <main style={styles.container}>
          <section style={styles.header}>
            <div style={styles.logo}>Q</div>
            <div>
              <p style={styles.eyebrow}>QingNest 轻巢</p>
              <h1 style={styles.title}>站点发布成功</h1>
            </div>
          </section>

          <section style={styles.card}>
            <p style={styles.greeting}>{userName}，</p>
            <p style={styles.paragraph}>
              <strong>{siteName}</strong> 已完成发布。你现在可以访问公开链接，并继续在控制台上传新版本。
            </p>

            <a href={siteUrl} style={styles.primaryButton}>
              打开站点
            </a>

            <div style={styles.urlBox}>
              <p style={styles.label}>公开访问地址</p>
              <a href={siteUrl} style={styles.urlText}>
                {siteUrl}
              </a>
            </div>

            <hr style={styles.divider} />

            <h2 style={styles.sectionTitle}>接下来可以做什么</h2>
            <ul style={styles.list}>
              <li style={styles.listItem}>检查首页、移动端布局和关键跳转是否符合预期。</li>
              <li style={styles.listItem}>保留最近可用版本，避免无效部署占用免费额度。</li>
              <li style={styles.listItem}>如需更大文件、更多站点或更高部署频率，可在套餐配置中调整。</li>
            </ul>

            {deploymentId && (
              <div style={styles.metaBox}>
                <p style={styles.label}>部署编号</p>
                <p style={styles.metaText}>{deploymentId}</p>
              </div>
            )}

            <a href={dashboardUrl} style={styles.secondaryButton}>
              回到 QingNest 控制台
            </a>
          </section>

          <footer style={styles.footer}>
            <p style={styles.footerText}>
              如果这次发布不是你本人操作，请联系{" "}
              <a href={`mailto:${supportEmail}`} style={styles.footerLink}>
                {supportEmail}
              </a>
              。
            </p>
            <p style={styles.footerMuted}>QingNest 轻巢，一键发布静态站点。</p>
          </footer>
        </main>
      </body>
    </html>
  );
}

const styles: Record<string, React.CSSProperties> = {
  body: {
    margin: 0,
    padding: 0,
    backgroundColor: "#f4f7fb",
    color: "#152033",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif'
  },
  preview: {
    display: "none",
    overflow: "hidden",
    lineHeight: "1px",
    opacity: 0,
    maxHeight: 0,
    maxWidth: 0
  },
  container: {
    width: "100%",
    maxWidth: 640,
    margin: "0 auto",
    padding: "32px 20px"
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginBottom: 20
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#0f766e",
    color: "#ffffff",
    fontSize: 24,
    fontWeight: 800,
    lineHeight: "44px",
    textAlign: "center"
  },
  eyebrow: {
    margin: "0 0 4px",
    color: "#0f766e",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 0
  },
  title: {
    margin: 0,
    color: "#0f172a",
    fontSize: 26,
    lineHeight: "32px"
  },
  card: {
    backgroundColor: "#ffffff",
    border: "1px solid #dbe4ef",
    borderRadius: 18,
    padding: 28,
    boxShadow: "0 14px 36px rgba(15, 23, 42, 0.08)"
  },
  greeting: {
    margin: "0 0 12px",
    fontSize: 16,
    lineHeight: "26px"
  },
  paragraph: {
    margin: "0 0 24px",
    fontSize: 16,
    lineHeight: "28px",
    color: "#334155"
  },
  primaryButton: {
    display: "inline-block",
    padding: "13px 22px",
    borderRadius: 10,
    backgroundColor: "#0f766e",
    color: "#ffffff",
    fontSize: 15,
    fontWeight: 700,
    textDecoration: "none"
  },
  urlBox: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0"
  },
  label: {
    margin: "0 0 6px",
    color: "#64748b",
    fontSize: 13,
    fontWeight: 700
  },
  urlText: {
    color: "#0f766e",
    fontSize: 15,
    lineHeight: "24px",
    wordBreak: "break-all",
    textDecoration: "none"
  },
  metaBox: {
    margin: "0 0 24px",
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0"
  },
  metaText: {
    margin: 0,
    color: "#334155",
    fontSize: 13,
    lineHeight: "20px",
    wordBreak: "break-all"
  },
  divider: {
    border: 0,
    borderTop: "1px solid #e2e8f0",
    margin: "26px 0"
  },
  sectionTitle: {
    margin: "0 0 12px",
    color: "#0f172a",
    fontSize: 18,
    lineHeight: "26px"
  },
  list: {
    margin: "0 0 24px",
    paddingLeft: 20,
    color: "#334155"
  },
  listItem: {
    margin: "0 0 10px",
    fontSize: 15,
    lineHeight: "24px"
  },
  secondaryButton: {
    display: "inline-block",
    padding: "12px 18px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    color: "#0f172a",
    fontSize: 14,
    fontWeight: 700,
    textDecoration: "none"
  },
  footer: {
    padding: "20px 8px 0",
    color: "#64748b",
    fontSize: 13,
    lineHeight: "22px"
  },
  footerText: {
    margin: "0 0 8px"
  },
  footerLink: {
    color: "#0f766e",
    textDecoration: "none"
  },
  footerMuted: {
    margin: 0
  }
};
