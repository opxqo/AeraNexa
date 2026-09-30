import { DEMO_ACCOUNT, DEMO_EMAIL_CODE } from "./session";

// The one-line hints the demo site adds to the sign-in pages, which say what to type.

export const demoHints = {
  zh: {
    login: `演示账号 ${DEMO_ACCOUNT.login}，密码 ${DEMO_ACCOUNT.password}`,
    code: `演示站不发邮件，验证码固定为 ${DEMO_EMAIL_CODE}`,
  },
  en: {
    login: `Demo account ${DEMO_ACCOUNT.login}, password ${DEMO_ACCOUNT.password}`,
    code: `The demo sends no email; the code is always ${DEMO_EMAIL_CODE}`,
  },
};
