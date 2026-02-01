# Usage Examples

This guide shows how to interact with GLaDOS through example conversations. These demonstrate the key capabilities that make GLaDOS more than a generic chatbot.

## Basic Conversation

GLaDOS responds naturally to questions and requests:

```
You: What can you help me with?

GLaDOS: I can help you with a variety of things:

  - Managing your calendar and schedule
  - Tracking projects and goals
  - Remembering information about people and relationships
  - Creating and managing tasks
  - Answering questions based on what I know about you
  - Taking actions on your behalf (with your approval)

  What would you like to do?
```

## Context-Aware Responses

GLaDOS knows your schedule, projects, and relationships. This context shapes every interaction.

### Calendar Awareness

```
You: What's on my calendar today?

GLaDOS: Here's your schedule for today (Tuesday, Feb 4):

  9:00 AM - Team standup (15 min)
  11:00 AM - Client call with Acme Corp
    Attendees: Sarah Chen, Mike Torres
  2:00 PM - 1:1 with Jamie
  4:00 PM - Focus time (blocked)

  You have 2 hours free this morning before the client call.
  Would you like me to help you prepare for any of these?
```

### Project Context

```
You: How's the website redesign going?

GLaDOS: Based on your project tracking:

  Website Redesign - Phase 2
  Status: In Progress (65% complete)
  Priority: High

  Recent activity:
  - Last week: Approved homepage mockups
  - Yesterday: Received technical requirements from Mike

  Open items:
  - Review technical requirements doc
  - Schedule design review meeting

  You have a call with the Acme team at 11 AM today -
  this might be a good time to discuss the requirements.
```

### People Awareness

```
You: When did I last talk to David?

GLaDOS: Your last interaction with David Chen was 5 days ago:

  - Email exchange about the Q4 proposal
  - He said he'd review it and get back to you
  - No response yet

  David is your contact at TechCorp (relationship: professional).
  Would you like me to draft a follow-up?
```

## Task Management

GLaDOS helps you track both simple tasks and complex multi-step workflows.

### Creating a Task

```
You: Remind me to review the budget proposal before Friday

GLaDOS: I've created a task:

  "Review budget proposal"
  Due: Friday, Feb 7

  I'll remind you Thursday evening if you haven't marked it complete.
  Would you like me to add any notes or break this into steps?
```

### Complex Task Delegation

```
You: Book me a flight to London for the AI conference next month

GLaDOS: I'll help you book that. Let me gather some information:

  The AI Summit is March 15-17 in London.

  Questions:
  1. When would you like to fly out? (March 14 recommended for jet lag)
  2. Return date? (March 18 gives you a buffer day)
  3. Any airline preferences?
  4. Budget range?

You: March 14-18 works. No preference on airline, keep it under $2000

GLaDOS: Got it. I'll search for flights and get back to you with options.
        This might take a few minutes - I'll notify you when ready.

[Later...]

GLaDOS: Found flight options for London:

  1. United - $1,450 (direct, 10h45m)
     Mar 14: SFO 18:30 → LHR 12:15+1
     Mar 18: LHR 09:00 → SFO 12:15

  2. British Airways - $1,680 (direct, 10h30m)
     Mar 14: SFO 20:00 → LHR 14:30+1
     Mar 18: LHR 11:00 → SFO 14:30

  3. Lufthansa - $1,320 (1 stop via Frankfurt, 14h)
     Mar 14: SFO 15:00 → LHR 14:00+1
     Mar 18: LHR 08:00 → SFO 14:00

  Based on your past trips, you've preferred direct flights.
  Which would you like?

You: Book option 1

GLaDOS: ⚠️ Approval Required

        Book United flights for $1,450?
        This will charge your saved payment method.

        [Confirm] [Cancel]

You: [Confirms]

GLaDOS: Booked! Confirmation: UA1234

        I've added the flights to your calendar and set a packing
        reminder for March 13.

        Would you like me to research hotels near the conference venue?
```

## Tool Usage and Approvals

GLaDOS can take actions on your behalf, but asks for approval on anything risky.

### Low-Risk Actions (Automatic)

```
You: What time is it in Tokyo?

GLaDOS: It's currently 2:30 AM in Tokyo (Wednesday).
        That's 16 hours ahead of your current time.
```

### Medium-Risk Actions (Approval Required)

```
You: Add a meeting with Sarah tomorrow at 2pm

GLaDOS: ⚠️ Approval Required

        Create calendar event:
        "Meeting with Sarah"
        Tomorrow (Wed, Feb 5) at 2:00 PM
        Duration: 1 hour

        [Create] [Edit] [Cancel]

You: [Creates]

GLaDOS: Done! I've added the meeting to your calendar.
        Should I send Sarah an invite?
```

### High-Risk Actions (Detailed Approval)

```
You: Send David a follow-up about the proposal

GLaDOS: I've drafted a follow-up email:

        To: david.chen@techcorp.com
        Subject: Re: Q4 Proposal - Following Up

        Hi David,

        I wanted to check in on the Q4 proposal I sent last week.
        Have you had a chance to review it? Happy to discuss any
        questions or make adjustments.

        Let me know when you have a moment.

        Best,
        [Your name]

        ⚠️ Approval Required

        This will send an email to David Chen.

        [Send] [Edit] [Cancel]
```

## Memory and Learning

GLaDOS remembers context from past conversations and learns how you prefer things done.

### Remembering Facts

```
You: My new address is 123 Oak Street, Apt 4B

GLaDOS: Got it! I've updated your home address to:
        123 Oak Street, Apt 4B

        I'll use this for any location-based suggestions.
```

### Learning Procedures

```
You: When you book flights for me, always check for direct options first
     and prefer morning departures

GLaDOS: Noted! I've saved your flight preferences:
        - Prioritize direct flights
        - Prefer morning departure times

        I'll apply these to future flight searches.
```

### Recalling Past Context

```
You: What did we discuss about the marketing budget?

GLaDOS: In our conversation last Tuesday, you mentioned:

        - Marketing budget needs to increase by 15% for Q2
        - Focus on digital channels over print
        - Sarah is handling the proposal
        - Decision needed by end of month

        Would you like me to pull up the full conversation?
```

## Proactive Notifications

GLaDOS doesn't just respond - it proactively helps when appropriate.

### Morning Briefing

```
[8:00 AM notification]

GLaDOS: Good morning! Here's your day:

  📅 Today's Schedule:
  • 9:00 - Standup (15 min)
  • 11:00 - Client call with Acme Corp
  • 2:00 - 1:1 with Jamie
  • 4:00 - Focus time blocked

  📋 Tasks Due Today:
  • Review budget proposal
  • Send weekly report

  ⚠️ Needs Attention:
  • No response from David (5 days)

  Anything you'd like help with this morning?
```

### Meeting Preparation

```
[30 minutes before client call]

GLaDOS: Your call with Acme Corp starts in 30 minutes.

  Attendees: Sarah Chen (PM), Mike Torres (Tech Lead)

  Suggested prep:
  • Review the technical requirements doc Mike sent
  • Check the mockup feedback from last week

  Want me to summarize the requirements doc?
```

### Follow-up Reminders

```
[3 days after delegating a task]

GLaDOS: Still waiting on David's response about the proposal.

  Options:
  • Send another follow-up email
  • Try reaching him on LinkedIn
  • Wait a few more days

  What would you prefer?
```

## CLI Commands

The CLI provides shortcuts for common actions:

| Command | Description |
|---------|-------------|
| `/new` | Start a fresh conversation |
| `/history` | View recent conversation history |
| `/clear` | Clear the screen |
| `/help` | Show available commands |
| `/quit` | Exit the CLI |

## Tips for Effective Use

1. **Be specific**: "Schedule a call with Sarah about the website project" works better than "Schedule a call"

2. **Provide context**: If GLaDOS doesn't know about something, tell it. "Sarah is our new designer who joined last week"

3. **Teach preferences**: When GLaDOS does something differently than you'd like, tell it your preference. It will remember.

4. **Use tasks for follow-ups**: "Remind me to check on this Friday" creates a task that GLaDOS will track

5. **Trust the approvals**: GLaDOS asks for confirmation on anything that could have unintended consequences. This is a feature, not a limitation.

## Telegram Commands

When using the Telegram bot:

| Command | Description |
|---------|-------------|
| `/start` | Initialize the bot |
| `/new` | Start a fresh conversation |
| `/help` | Show available commands |

The Telegram bot has the same capabilities as the CLI - just type naturally and GLaDOS will respond.
