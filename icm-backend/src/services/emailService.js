import dotenv from "dotenv";
import env from "../config/env.js";
import EmailService from "./email/EmailService.js";
import GmailProvider from "./email/providers/GmailProvider.js";
import * as certificationLaunch from "./email/templates/certificationLaunch.js";
import * as certificationReminder from "./email/templates/certificationReminder.js";
import * as passwordReset from "./email/templates/passwordReset.js";
import * as adminInitiatedReset from "./email/templates/adminInitiatedReset.js";
import * as passwordOtp from "./email/templates/passwordOtp.js";
import * as ownerActionExpired from "./email/templates/ownerActionExpired.js";
import * as identityOnboarding from "./email/templates/identityOnboarding.js";

dotenv.config();

const gmailProvider = new GmailProvider();

const BACKEND_PUBLIC_URL = env.backendUrl;
const FRONTEND_URL = env.frontendUrl;

export function getMailTransporter() {
  return gmailProvider.getTransporter();
}

export async function sendEmail({ to, subject, html, attachments, metadata }) {
  return EmailService.send({ to, subject, html, attachments, metadata });
}

export async function buildPasswordResetEmail(params) {
  return passwordReset.render(params);
}

export async function buildAdminInitiatedResetEmail(params) {
  return adminInitiatedReset.render(params);
}

export async function buildPasswordOtpEmail(params) {
  return passwordOtp.render(params);
}

export async function buildCertificationAssignmentEmail(params) {
  return certificationLaunch.render(params);
}

export async function buildCertificationReminderEmail(params) {
  return certificationReminder.render(params);
}

export async function buildOwnerActionExpiredEmail(params) {
  return ownerActionExpired.render(params);
}

export async function buildIdentityOnboardingEmail(params) {
  return identityOnboarding.render(params);
}

export { BACKEND_PUBLIC_URL, FRONTEND_URL };
