import "server-only";

export function getEmailVerificationCode(): string {
  return process.env.EMAIL_VERIFICATION_CODE?.trim() || "666666";
}
