# ZeroStars UI review — 3 October 2026

## Scope and evidence
Reviewed the live homepage at 1440×900 and 390×844, opened the authentication dialog, and inspected the deployed version’s frontend and Express source. No production accounts or complaints were created. Complaint, business, profile, and moderation findings are source-based because the live database is empty. This is a usability review, not a full WCAG compliance audit. No product changes were made.

## Priority 1 — remove barriers

1. **Mobile header overflow.** At 390px viewport width the document is 544px wide. The logo, tagline, database badge, account action, theme control and complaint button remain in one row. The primary button sits outside the viewport. Use a compact logo and account/menu control, move the complaint action to a second row or primary content area, and remove the database badge. Verify 320, 390, 768 and 1440px widths, including a signed-in account with a long email.
2. **Sign-in intent is lost.** Clicking Sign in opens Create your free account with Register selected. Successful authentication always calls openComplaintForm, including authentication initiated for other activities. Make Sign in open login; registration should be an explicit alternative. Resume the exact requested action, retaining business details. Ordinary login should return to the current page.
3. **Draft loss.** Escape, backdrop click, Cancel and Close destroy the modal DOM immediately. Preserve a device-local draft with an explicit discard option; warn before discarding unsaved text. Do not store sensitive account credentials in browser storage.
4. **Dialog and keyboard accessibility.** Modal containers lack dialog semantics and accessible titles; focus is not trapped or restored; background content remains interactive. Use native dialog or an accessible dialog implementation. Search and filter controls need accessible labels. Error messages and toasts need live announcements. Forms should submit using Enter where appropriate and associate field errors with their inputs.
5. **Trust and identity.** The footer and authentication dialog still describe a local SQLite prototype even though data now resides in Supabase. Remove implementation claims from user copy and explain public visibility. Public author labels currently derive from the email prefix; let users choose a public display name and preview it before publishing. Business replies currently accept any signed-in user’s chosen name; either verify business ownership or clearly label replies as unverified. Do not imply verified representation.

## Priority 2 — simplify primary journeys

6. **Homepage hierarchy.** Desktop has an approximately 198px header and search starts around 630px down. Mobile search starts around 650px. Reduce header and hero height. Lead with a brief purpose statement, Search the register and File a complaint. Retain the distinctive logo and pink/brown palette. Move longer brand statements below the working surface.
7. **Empty states.** Nothing here. Suspiciously quiet. conflates an empty database with filtered results and offers no action. For a new register: No complaints yet, with File the first complaint. For filtered results: No matching complaints, with Clear filters. During an outage: Could not load complaints, with Retry. Hide the average until data exists rather than showing −0.0. Metadata failures currently silently become zero counts; expose a failed state.
8. **Complaint form.** Mark required fields, provide inline validation and explain the minimum description length before submission. Use a business lookup to avoid duplicated/misidentified businesses. Category should require deliberate selection rather than defaulting to Trades & Construction. Location should have a clear format. Use plain severity labels with examples; avoid an unexplained default of −3. Add a review step showing business, display name and what will become public. Label the final action Publish complaint. Show a lasting confirmation and complaint reference.
9. **Search/filter feedback.** Label controls, show active filters and Clear all, reduce mobile filter clutter, and announce result counts. Prevent older search responses from overwriting newer results. For large datasets add pagination or Load more instead of rendering every complaint.
10. **Navigation and sharing.** The router only changes in-memory state, so business/profile views have no distinct URL, browser history or refresh persistence. Use addressable routes and real links for business and complaint pages, preserve filters when returning, and support browser Back. Create a complaint detail page for sharing and reading long cases.
11. **Complaint cards.** Source renders full complaint bodies in each card despite the excerpt class. Show a short summary with Read full complaint, simplify repeated category/severity badges, and make the business/title/date/status easy to scan. Explain Back this complaint as a solidarity action, not a negative rating. Show business response and dispute status distinctly.
12. **Status accuracy.** statusLabel maps resolved to Unresolved, and filters omit resolved. Use consistent Unresolved, Business responded, Resolved and Under review labels. A response is not necessarily a resolution. Preserve this distinction in totals, cards and business pages.

## Priority 3 — polish and recovery

13. **Readability.** Light theme uses #8d98a7 on pale backgrounds for small metadata and hints. Darken secondary text, use comfortable text sizes, and test contrast in both themes. Make small Close and sign-out controls easier to tap. Ensure sticky filters do not overlap the header: their hard-coded offsets do not match current header heights.
14. **Tone and wording.** Keep brand personality in headlines; use calm, precise instructions in forms/errors. Replace Make yourself heard with File a complaint, Put it on the record with Publish complaint, and egregious with an understandable severity label. Avoid accusatory empty/error messages and claims that publication guarantees a business will respond.
15. **Account recovery.** Offer show/hide password and password reset, ensure reset is backed by a secure implementation, and keep requirements specific to registration. Persist theme preference. Replace the power icon with a clearly named Sign out action.
16. **Motion.** Respect reduced-motion preference for the animated logo; use the static poster in that mode.
17. **Moderation and business response.** Provide neutral explanations, review status and next steps. Show review decisions clearly and distinguish moderation state from complaint outcome. Check focus, long content, validation and confirmation for these screens in a disposable test environment.

## Recommended implementation order

First repair mobile layout, authentication intent, draft safety and dialog accessibility. Next simplify the homepage and empty states, remove outdated prototype wording and clarify public identity. Then redesign complaint submission and cards, implement URL/history navigation and accurate statuses, and improve account recovery and secondary flows.

## Acceptance checks

- No horizontal scrolling at 320–1440px; primary actions remain visible.
- Login, registration, complaint filing, backing, commenting and business reply resume the intended task.
- Draft text survives accidental dismissal or requires explicit discard.
- Keyboard users can enter/exit dialogs and see focus; assistive technology receives labels/errors/statuses.
- Empty, filtered, loading and failed states are distinct and actionable.
- Public identity/visibility is clear before publication; business representation is accurately labelled.
- Back, refresh and share links preserve the relevant page.
- Resolved complaints show correct labels and filters.
- Complete authenticated workflows are verified against disposable data before publication.
