# Supabase auth email templates

Supabase sends the auth emails (password reset, invite, magic link, confirm signup) from
templates that live **in the Supabase dashboard**, not in this repo. Until now they were the
factory defaults, which is why they looked generic and nothing like the site.

These files are the source of truth for that HTML. Edit them here, then paste into the
dashboard.

## Where to paste

Supabase dashboard → **Authentication → Emails → Templates**, then pick the template on the
left, paste the file's whole contents into the *Message body* box, set the *Subject* below,
and **Save**.

| File | Dashboard template | Subject line to set |
|---|---|---|
| `reset-password.html` | Reset Password | `Set a new CleanNami password` |
| `invite-user.html` | Invite user | `Your CleanNami account is ready` |
| `magic-link.html` | Magic Link | `Your CleanNami sign-in link` |
| `confirm-signup.html` | Confirm signup | `Confirm your CleanNami email` |
| `change-email.html` | Change Email Address | `Confirm your new CleanNami email` |
| `reauthentication.html` | Reauthentication | `Your CleanNami confirmation code` |

## Which of these actually send today

- **Reset Password** — yes. This is the one behind "Forgot your password?" and the one the
  client saw as generic.
- **Magic Link / Invite user** — Supabase's own versions are effectively unused right now:
  the customer portal email is rendered by this app and sent through Resend
  (`lib/emails/CustomerPortalEmail.tsx`). Worth setting anyway so nothing generic can leak
  out later.
- **Confirm signup** — does not send. Email confirmation is switched off on the project
  (`mailer_autoconfirm` is `true`), so nobody is asked to confirm an address.
- **Change Email / Reauthentication** — only send if those features get turned on.

## Design

Matched to the site rather than invented:

- Brand blue `#0915AC` — the `--color-brand` token in `app/globals.css`
- `#6b73cd` for the "Nami" half of the wordmark — that's `text-brand/60` composited on white,
  the same treatment as the site header
- White card, `16px` radius, `1px #e5e7eb` border on a `#f3f4f6` page — the auth pages' look
- System font stack. The site's Arkhip wordmark font is a local `.ttf` and can't be relied on
  in email clients, so the wordmark is set in bold system type instead

Table-based layout with inline styles, so it survives Outlook. No external images, so nothing
breaks when a client blocks remote content.

## Preview

Open any of the `.html` files directly in a browser. The `{{ … }}` placeholders will show as
literal text — that's expected; Supabase fills them in when it sends.

## Template variables used

`{{ .ConfirmationURL }}` (the action link), `{{ .Email }}`, `{{ .NewEmail }}` (change-email
only), `{{ .Token }}` (reauthentication only), `{{ .SiteURL }}`. These are Supabase's, and
they are what the dashboard editor expects.
