import "server-only";

import nodemailer from "nodemailer";
import { getSmtpTransportConfig } from "./smtp-settings";

export async function sendVerificationEmail(input: { to: string; purpose: "register" | "reset-password"; code: string }): Promise<void> {
  const config = await getSmtpTransportConfig(true);
  const subject = input.purpose === "register" ? "AeraNexa 注册验证码" : "AeraNexa 密码重置验证码";
  const action = input.purpose === "register" ? "完成注册" : "重置密码";
  const transporter = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth });
  await transporter.sendMail({
    from: config.from,
    to: input.to,
    subject,
    text: `你的 AeraNexa ${action}验证码是：${input.code}。验证码 10 分钟内有效，请勿向任何人泄露。`,
  });
}

export async function sendSmtpTestEmail(to: string): Promise<void> {
  const config = await getSmtpTransportConfig(false);
  const transporter = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth });
  await transporter.verify();
  await transporter.sendMail({ from: config.from, to, subject: "AeraNexa SMTP 测试邮件", text: "SMTP 连接和邮件投递配置已通过 AeraNexa 测试。" });
}
