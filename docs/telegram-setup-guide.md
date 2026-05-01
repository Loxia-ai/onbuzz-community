# Telegram Bot Setup & Testing Guide

## Prerequisites
- OnBuzz Community running locally (v3.0.2+)
- A Telegram account on your phone
- Internet connection on the machine running OnBuzz

---

## Step 1: Create a Telegram Bot

1. Open Telegram on your phone
2. Search for **@BotFather** (the official Telegram bot for creating bots)
3. Send `/newbot`
4. BotFather will ask for a **name** — type something like `OnBuzz Community`
5. BotFather will ask for a **username** — must end in `bot`, e.g. `onbuzz_bot`
6. BotFather will respond with your **bot token** — looks like `7123456789:AAH1bGzR...`
7. **Copy the token** — you'll need it in the next step

> Keep this token secret. Anyone with it can control your bot.

---

## Step 2: Connect the Bot in OnBuzz

### Option A: Via Web UI
1. Open the OnBuzz Web UI (`http://localhost:8080`)
2. Go to **Settings** (gear icon in sidebar)
3. Scroll to the **Telegram Bot** section
4. Paste the bot token into the **Bot Token** field
5. Click **Connect**
6. Status should change to green with `@your_bot_username`

### Option B: Via API (for debugging)
```bash
curl -X POST http://localhost:8080/api/telegram/connect \
  -H "Content-Type: application/json" \
  -d '{"botToken": "YOUR_TOKEN_HERE"}'
```
Expected response: `{"success": true, "username": "onbuzz_bot", "id": 7123456789}`

---

## Step 3: Register Your Chat

1. On your phone, open Telegram
2. Search for your bot by username (e.g. `@onbuzz_bot`)
3. Tap **Start** or send `/start`
4. You should see: **"OnBuzz Community connected!"**

> Only the first chat to send /start gets registered. All other chats are ignored for security.

### Verify registration
Check the Settings page — the **Chat ID** should now appear in the Telegram section.

Or via API:
```bash
curl http://localhost:8080/api/telegram/status
```
Expected: `"chatId": "123456789"` (your Telegram user ID)

---

## Step 4: Test Basic Commands

Send these commands from Telegram to your bot:

| Send | Expected Response |
|------|-------------------|
| `/help` | List of all available commands |
| `/status` | Agent count, active/idle, notification status |
| `/agents` | List of loaded agents with status indicators and selection buttons |

If `/agents` shows agents, tap one of the agent name buttons to see its details.

---

## Step 5: Test Sending a Message to an Agent

### Prerequisite: Have at least one agent loaded in OnBuzz

1. Send: `@agent-name hello, what can you do?`
   - Replace `agent-name` with the actual name of a loaded agent (e.g. `@coder`, `@striker-1`)
2. You should see:
   - `📨 → agent-name` (confirmation)
   - After a few seconds: the agent's response, formatted with markdown

### Test sticky session (no prefix)
3. Send: `tell me more`
   - Should go to the same agent (last used)
4. The response should arrive in Telegram

### Test multiple agents
5. Send: `@another-agent hi there`
6. Now both agents are being followed
7. Send: `/following` — should list both agents

---

## Step 6: Test the Send Test Button

1. In the OnBuzz Web UI → Settings → Telegram Bot section
2. Click **Send Test**
3. Check your phone — you should receive "OnBuzz Community — test message received!"

---

## Step 7: Test Notifications (Optional)

1. From Telegram, send: `/watch`
2. You should see: "Notifications enabled"
3. Now trigger an event that generates a notification:
   - Set an agent to autonomous mode from the Web UI and let it work
   - If an agent encounters an error or completes its task, you'll get a push notification
4. To stop: send `/unwatch`

---

## Step 8: Test Flows (Optional)

1. Send: `/flows`
2. If you have flows defined, you'll see a list with **Run** buttons
3. Tap a Run button or send: `/run flow-name`
4. With `/watch` enabled, you'll be notified when the flow completes or fails

---

## Step 9: Test Following/Unfollowing

1. Address two different agents:
   - `@agent-1 hello`
   - `@agent-2 hello`
2. Send: `/following`
   - Should show both agents, with agent-2 marked as (active)
3. Tap **Unfollow** on agent-1 (or send `/unfollow agent-1`)
4. Agent-1's responses will no longer be relayed to Telegram
5. Agent-2's responses still come through

---

## Step 10: Test Web UI + Telegram Together

This tests the multi-observer scenario:

1. Have the OnBuzz Web UI open on your laptop
2. From Telegram, send a message to an agent: `@coder what files did you modify?`
3. Check **both**:
   - Telegram: should receive the agent's response
   - Web UI: switch to the same agent — the message you sent from Telegram and the agent's response should both appear in the chat history
4. Now send a message from the **Web UI** to the same agent
5. The agent's response will appear in the Web UI (always) and in Telegram (if the agent is in your activeAgentIds)

---

## Troubleshooting

### Bot doesn't respond to /start
- Check that the OnBuzz server is running
- Check Settings → Telegram section shows "Connected"
- Check server logs for `[TelegramService]` entries
- Verify the bot token is correct

### "Another chat is already registered"
- A different Telegram chat already sent /start
- Go to Settings → Telegram → Disconnect, then reconnect and send /start again

### Agent message not relayed to Telegram
- Make sure you addressed the agent with `@name` first (it must be in activeAgentIds)
- Send `/following` to check which agents are being tracked
- If the agent was created after you connected, it needs to be addressed first

### Messages arrive in Web UI but not Telegram
- This is expected for agents NOT in your activeAgentIds
- Address the agent from Telegram (`@agent-name hi`) to start following it

### Bot token exposed
- Go to @BotFather on Telegram, send `/revoke`, select your bot
- Get a new token and reconnect in OnBuzz Settings

### Disconnect
- From Web UI: Settings → Telegram → Disconnect
- Via API: `curl -X POST http://localhost:8080/api/telegram/disconnect`
- The bot will stop polling and no longer respond

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/telegram/status` | GET | Connection status, chat ID, bot username |
| `/api/telegram/connect` | POST | Connect with `{ "botToken": "..." }` |
| `/api/telegram/disconnect` | POST | Stop the bot |
| `/api/telegram/test` | POST | Send a test message to registered chat |
| `/api/telegram/settings` | GET | Get notification preferences |
| `/api/telegram/settings` | POST | Update settings `{ "watchEnabled": true }` |

---

## Bot Commands Reference

| Command | Description |
|---------|-------------|
| `/start` | Register this chat with the bot |
| `/help` | Show all commands |
| `/status` | System overview |
| `/agents` | List all agents (with selection buttons) |
| `/agent <name>` | Show agent details |
| `/following` | List agents you're following |
| `/unfollow <name>` | Stop following an agent |
| `/flows` | List available flows |
| `/run <flow>` | Start a flow |
| `/stop <agent>` | Stop an agent's execution |
| `/watch` | Enable push notifications |
| `/unwatch` | Disable push notifications |
| `/watching` | Check notification status |
| `@agent-name message` | Send message to a specific agent |
| `message` (no prefix) | Send to last addressed agent |
