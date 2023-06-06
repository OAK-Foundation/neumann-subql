import * as Sentry from '@sentry/node';

const sentryOptions = {
  environment: process.env.STACK_ENV || "development",
  dsn: process.env.SENTRY_DSN,

  tracesSampleRate: 1,
}

export const initSentry = async () => {
  Sentry.init(sentryOptions);
}
