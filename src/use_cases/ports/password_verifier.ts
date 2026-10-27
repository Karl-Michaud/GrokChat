/** Checks the admin password against the stored hash (PBKDF2-SHA-256 in the driver, plan §3.5). */
export interface PasswordVerifier {
  verify(password: string): Promise<boolean>;
}
