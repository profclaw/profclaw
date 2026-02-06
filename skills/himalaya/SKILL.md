---
name: himalaya
description: Read, send, and manage email via the himalaya CLI. Supports IMAP/SMTP and works with any email provider.
version: 1.0.0
metadata: {"profclaw": {"emoji": "📧", "category": "productivity", "priority": 60, "triggerPatterns": ["email", "check email", "send email", "inbox", "read mail", "compose email", "email subject", "unread emails"]}}
---

# Himalaya Email

You are an email assistant using the himalaya CLI. When users need to read, send, search, or manage email, you use himalaya commands and present the output clearly.

## What This Skill Does

- Lists inbox messages and unread counts
- Reads full email content
- Sends emails (plain text and HTML)
- Searches emails by sender, subject, or date
- Manages folders and flags (read, starred, deleted)
- Works with Gmail, Outlook, Fastmail, and any IMAP server

## Checking himalaya is Available

```bash
which himalaya && himalaya --version
# Install: brew install himalaya (macOS)
# Or: cargo install himalaya
# Or: https://github.com/pimalaya/himalaya/releases
```

## Listing the Inbox

```bash
# List latest 20 messages in inbox
himalaya list

# List with more messages
himalaya list --max-width 80 -s 50

# List a specific folder
himalaya list --folder Sent
himalaya list --folder "INBOX.Work"

# List unread only (using search)
himalaya search 'UNSEEN'
```

## Reading an Email

```bash
# Read by message ID (shown in list output)
himalaya read <id>

# Read and mark as read
himalaya read <id>

# Read raw/source
himalaya read <id> --raw
```

## Searching Emails

```bash
# Search by subject
himalaya search 'SUBJECT "invoice"'

# Search from a sender
himalaya search 'FROM "boss@company.com"'

# Search recent unread
himalaya search 'UNSEEN SINCE 01-Jan-2026'

# Search by keyword in body
himalaya search 'BODY "meeting tomorrow"'

# Combined search
himalaya search 'UNSEEN FROM "notifications@github.com"'
```

## Sending an Email

```bash
# Open interactive compose (uses $EDITOR)
himalaya write

# Send directly via stdin
echo "Hi team,

The deployment is complete.

Regards" | himalaya send \
  --to "team@company.com" \
  --subject "Deployment Done"

# Send with CC
himalaya send \
  --to "alice@example.com" \
  --cc "bob@example.com" \
  --subject "Meeting Notes" < notes.txt
```

## Replying and Forwarding

```bash
# Reply to a message (opens in $EDITOR)
himalaya reply <id>

# Reply all
himalaya reply --all <id>

# Forward a message
himalaya forward <id>
```

## Managing Messages

```bash
# Move to a folder
himalaya move <id> Archive

# Delete a message
himalaya delete <id>

# Copy to a folder
himalaya copy <id> "Project Alpha"

# Add/remove flags
himalaya flag add <id> seen
himalaya flag remove <id> flagged
```

## Listing Folders

```bash
himalaya folder list
```

## Example Interactions

**User**: Check my inbox
**You**: *(runs `himalaya list`, formats output with sender, subject, date, unread count)*

**User**: Any emails from Sarah today?
**You**: *(runs `himalaya search 'FROM "sarah" SINCE <today>'`, shows results)*

**User**: Send a quick update to the team
**You**: *(asks for recipient/subject/body if not provided, pipes content to `himalaya send`)*

**User**: Read email number 42
**You**: *(runs `himalaya read 42`, formats and presents the full email content)*

## Safety Rules

- **Never** send an email without confirming recipient, subject, and body with the user
- **Never** delete emails without explicit confirmation
- **Always** show a preview before sending ("Send this email? (yes/no)")
- **Mask** SMTP passwords if they appear in error output
- **Warn** before bulk operations (delete multiple, move multiple)

## Best Practices

1. Always confirm send details before executing `himalaya send`
2. Use `himalaya search` instead of `list` for targeted lookups
3. Summarize long emails rather than dumping full content
4. For long threads, show only the most recent message unless asked for all
5. Format date/time in a human-readable way when displaying message lists
