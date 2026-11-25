'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('./logger');

let transport;

function buildTransport() {
  const { host, port, secure, user, pass } = config.smtp;
  return nodemailer.createTransport({
    host,
    port,
    secure, // true for implicit TLS (port 465); otherwise STARTTLS is used when offered
    auth: user ? { user, pass } : undefined,
  });
}

/**
 * Tests (or tools) can swap the transport: anything with sendMail(message),
 * e.g. a stub that records messages or nodemailer.createTransport({ jsonTransport: true }).
 * Pass nothing to go back to the configured SMTP transport.
 */
function setTransport(custom) {
  transport = custom;
}

/**
 * Sends one message. When SMTP_HOST is not set the message is not sent: the
 * link is logged at warn level instead so development works without a mail
 * server. Outside development that log line would leak a working reset link
 * into the logs, so there only the fact that mail is unconfigured is logged.
 */
async function sendMail({ to, subject, text, devLink }) {
  if (!transport && !config.smtp.host) {
    if (config.env === 'development') {
      logger.warn({ subject, link: devLink }, 'SMTP_HOST is not set: email not sent, use this link instead');
    } else {
      logger.warn({ subject }, 'SMTP_HOST is not set: email not sent');
    }
    return;
  }
  transport ??= buildTransport();
  await transport.sendMail({ from: config.smtp.from, to, subject, text });
}

async function sendPasswordReset({ to, first, link, ttlMinutes }) {
  await sendMail({
    to,
    subject: 'Reset your Event Planner password',
    text:
      `Hi ${first || 'there'},\n\n` +
      `Someone asked to reset the password for your Event Planner account. ` +
      `Use this link within ${ttlMinutes} minutes:\n\n${link}\n\n` +
      `If you did not ask for this, ignore this email: your password stays the same.\n`,
    devLink: link,
  });
}

module.exports = { sendMail, sendPasswordReset, setTransport };
