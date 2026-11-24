'use strict';

const { badRequest } = require('../lib/errors');

/**
 * Validates req[source] against a zod schema and replaces it with the parsed
 * (trimmed, coerced) value. Unknown keys are stripped, so clients cannot set
 * fields such as user_role or event_organizer through the request body.
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!fields[key]) fields[key] = issue.message;
      }
      return next(badRequest('Please correct the highlighted fields.', fields));
    }
    // Express 5 makes req.query a getter, so store parsed values separately.
    req.valid = { ...(req.valid || {}), [source]: result.data };
    next();
  };
}

module.exports = { validate };
