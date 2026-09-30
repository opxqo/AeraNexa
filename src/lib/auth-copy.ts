// Text of the sign-in, sign-up and reset-password pages (src/components/auth-card.tsx).
// Two languages share one type, so TypeScript flags anything missing from
// either; Chinese covers 简体 and 繁體, English stands in for 日本語 and 한국어.

export type AuthText = {
  titles: { login: string; register: string; forget: string; email: string; password: string; code: string; newPassword: string; resetPassword: string };
  google: string;
  github: string;
  email: string;
  emailPlaceholder: string;
  passwordPlaceholder: string;
  codePlaceholder: string;
  confirmPlaceholder: string;
  labels: { email: string; password: string; code: string; newPassword: string; confirm: string };
  continue: string;
  resetPassword: string;
  createAccount: string;
  back: string;
  backToLogin: string;
  backToRegister: string;
  forgot: string;
  resend: string;
  resendIn: (seconds: number) => string;
  codeSent: string;
  codeHint: (email: string) => string;
  footer: { noAccount: string; signUp: string; haveAccount: string; logIn: string; remember: string; agree: string; terms: string; and: string; privacy: string; end: string; forgotPrompt: string };
  errors: { email: string; password: string; code: string; mismatch: string; network: string; sendFailed: string; resetDone: string };
  invite: { valid: string; invalid: string; unverified: string };
  social: (provider: "Google" | "GitHub") => string;
  /** Read out while a button is busy. */
  loading: string;
  language: string;
};

export const authCopy: Record<"en" | "zh", AuthText> = {
  en: {
    titles: { login: "Log in to AeraNexa", register: "Create your account", forget: "Reset your password", email: "What’s your email address?", password: "Enter your password", code: "Check your email", newPassword: "Create a password", resetPassword: "Choose a new password" },
    google: "Continue with Google",
    github: "Continue with GitHub",
    email: "Continue with email",
    emailPlaceholder: "Enter your email address…",
    passwordPlaceholder: "Enter your password…",
    codePlaceholder: "Enter the code…",
    confirmPlaceholder: "Confirm your password…",
    labels: { email: "Email address", password: "Password", code: "Verification code", newPassword: "New password", confirm: "Confirm password" },
    continue: "Continue",
    resetPassword: "Reset password",
    createAccount: "Create account",
    back: "Back",
    backToLogin: "Back to log in",
    backToRegister: "Back to sign up",
    forgot: "Forgot password?",
    resend: "Resend code",
    resendIn: (seconds) => `Resend code in ${seconds}s`,
    codeSent: "We sent a verification code to your email.",
    codeHint: (email) => `We sent a code to ${email}.`,
    footer: { noAccount: "Don’t have an account?", signUp: "Sign up", haveAccount: "Already have an account?", logIn: "Log in", remember: "Remember your password?", agree: "By signing up, you agree to our", terms: "Terms of Service", and: "and", privacy: "Privacy Policy", end: ".", forgotPrompt: "Forgot your password?" },
    errors: { email: "Please enter a valid email address.", password: "Please enter your password.", code: "Please enter the verification code.", mismatch: "The two passwords do not match.", network: "Something went wrong. Please try again.", sendFailed: "Could not send the code. Please try again.", resetDone: "Password reset. Log in with your new password." },
    invite: { valid: "Invitation link is valid.", invalid: "This invite code is invalid.", unverified: "Could not verify the invite code; it will be checked again on sign-up." },
    social: (provider) => `${provider} sign-in is ready for credentials.`,
    loading: "Working…",
    language: "Language",
  },
  zh: {
    titles: { login: "登录 AeraNexa", register: "创建你的账户", forget: "重置密码", email: "你的邮箱地址是？", password: "输入你的密码", code: "查收你的邮件", newPassword: "设置密码", resetPassword: "设置新密码" },
    google: "使用 Google 继续",
    github: "使用 GitHub 继续",
    email: "使用邮箱继续",
    emailPlaceholder: "输入你的邮箱地址…",
    passwordPlaceholder: "输入密码…",
    codePlaceholder: "输入验证码…",
    confirmPlaceholder: "再次输入密码…",
    labels: { email: "邮箱地址", password: "密码", code: "邮箱验证码", newPassword: "新密码", confirm: "确认密码" },
    continue: "继续",
    resetPassword: "重置密码",
    createAccount: "创建账户",
    back: "返回",
    backToLogin: "返回登录",
    backToRegister: "返回注册",
    forgot: "忘记密码？",
    resend: "重新发送验证码",
    resendIn: (seconds) => `${seconds} 秒后可重新发送`,
    codeSent: "验证码已发送，请查收邮箱。",
    codeHint: (email) => `验证码已发送至 ${email}。`,
    footer: { noAccount: "还没有账户？", signUp: "注册", haveAccount: "已有账户？", logIn: "登录", remember: "想起密码了？", agree: "注册即表示你同意我们的", terms: "服务条款", and: "和", privacy: "隐私政策", end: "。", forgotPrompt: "忘记密码了？" },
    errors: { email: "请输入有效的邮箱地址。", password: "请输入密码。", code: "请输入邮箱验证码。", mismatch: "两次输入的密码不一致。", network: "请求失败，请检查网络后重试。", sendFailed: "验证码发送失败，请稍后重试。", resetDone: "密码已重置，请使用新密码登录。" },
    invite: { valid: "邀请链接有效，注册后将自动绑定邀请关系。", invalid: "邀请链接无效或已失效。", unverified: "暂时无法校验邀请码，提交注册时将再次验证。" },
    social: (provider) => `${provider} 登录已接入界面，等待填入凭证。`,
    loading: "处理中…",
    language: "语言",
  },
};

export const languages = [
  { code: "en-US", label: "English" },
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "ja-JP", label: "日本語" },
  { code: "ko-KR", label: "한국어" },
] as const;

export type LanguageCode = (typeof languages)[number]["code"];
export const textFor = (code: LanguageCode): AuthText => authCopy[code.startsWith("zh") ? "zh" : "en"];
