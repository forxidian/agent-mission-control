# Open Source Plan

This repository is prepared as a clean open-source export.

## Completed locally

- Copied the application into a fresh Git repository with no prior history.
- Removed personal absolute paths from docs and test fixtures.
- Added `.gitignore` coverage for local agent state, logs, databases, keys,
  dotenv files, and generated artifacts.
- Added MIT license, contribution notes, security guidance, and privacy notes.
- Marked the package as publishable source by removing `private: true`.

## Before publishing to GitHub

1. Re-run a sensitive-content scan for local usernames, personal paths, API
   keys, cookies, private-key headers, and provider-specific token formats.

2. Run the test suite:

   ```bash
   npm test
   ```

3. Review Git status and commit only the sanitized export.
4. Create a GitHub repository.
5. Push after confirming the repository visibility and license.

## Suggested repository settings

- Visibility: public, after final review.
- Default branch: `main`.
- Features: Issues enabled, Discussions optional.
- Security: enable private vulnerability reporting if available.
- Branch protection: require tests before merge once CI is added.
