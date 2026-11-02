// All dates in Looply are in the shop's local time. Servers (like Netlify's)
// usually run in UTC, so we set the time zone here, before any date is made.
// Change it with the APP_TIMEZONE setting, e.g. APP_TIMEZONE=Asia/Dubai
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';
