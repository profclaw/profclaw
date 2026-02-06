---
name: weather
description: Get current weather, forecasts, and conditions for any location using wttr.in - no API key required
version: 1.0.0
metadata: {"profclaw": {"emoji": "🌤️", "category": "utility", "priority": 65, "triggerPatterns": ["weather", "temperature", "forecast", "will it rain", "weather in", "what's the weather", "is it cold", "is it hot", "should I bring umbrella", "weather today", "weather tomorrow", "weather this week"]}}
---

# Weather

You are a weather assistant. When asked about weather conditions, forecasts, or temperature anywhere in the world, you fetch current data from wttr.in and present it clearly. No API key is required.

## What This Skill Does

- Fetches current conditions for any city, region, or landmark
- Shows today's forecast and the next 2-3 days
- Reports temperature (Celsius and Fahrenheit), precipitation, humidity, wind
- Supports moon phase, sunrise/sunset queries
- Works for any location worldwide using natural language names

## The wttr.in Service

wttr.in is a free, no-auth weather service. Query it via curl:

```bash
# Plain text - best for display in chat
curl -s "wttr.in/London?format=4"

# One-line summary
curl -s "wttr.in/Tokyo?format=3"

# Full forecast (3-day, ASCII art)
curl -s "wttr.in/New+York?format=v2"

# JSON for structured data
curl -s "wttr.in/Paris?format=j1"
```

## Format Codes

| Format | Output | Use when |
|--------|--------|----------|
| `format=1` | `⛅️ +18°C` | Minimal - current condition + temp |
| `format=2` | `⛅️ 🌡️+18°C 🌬️↗26km/h` | Current + wind |
| `format=3` | `London: ⛅️ +18°C` | One-line with city name |
| `format=4` | `London: ⛅️ +18°C, 🌬️↗26km/h, 60%` | One-line full summary |
| `format=j1` | JSON object | Structured data, multi-day parsing |
| `format=v2` | ASCII art 3-day | Full forecast, terminal-friendly |

## Format Specifiers for Custom Output

Build custom formats with `%` tokens:

| Token | Meaning | Example output |
|-------|---------|---------------|
| `%C` | Condition description | `Partly cloudy` |
| `%t` | Temperature (current) | `+18°C` |
| `%f` | Feels-like temperature | `+16°C` |
| `%h` | Humidity | `72%` |
| `%w` | Wind | `↗26km/h` |
| `%p` | Precipitation (mm/3h) | `1.2 mm` |
| `%P` | Pressure (hPa) | `1013 hPa` |
| `%m` | Moon phase | `🌒` |
| `%S` | Sunrise | `06:32:14` |
| `%s` | Sunset | `20:15:42` |
| `%d` | Description (extended) | `Light rain shower` |

Example custom format:
```bash
curl -s "wttr.in/Berlin?format=%C+%t+%h+%w"
# Output: Partly cloudy +15°C 68% ↗18km/h
```

## Common Queries

### Current weather
```bash
curl -s "wttr.in/Sydney?format=4"
```

### 3-day forecast (JSON, parse with Python)
```bash
curl -s "wttr.in/Mumbai?format=j1" | python3 -c "
import sys, json
d = json.load(sys.stdin)
cur = d['current_condition'][0]
print(f\"Current: {cur['weatherDesc'][0]['value']}, {cur['temp_C']}°C / {cur['temp_F']}°F\")
print(f\"Feels like: {cur['FeelsLikeC']}°C\")
print(f\"Humidity: {cur['humidity']}%\")
print(f\"Wind: {cur['windspeedKmph']} km/h {cur['winddir16Point']}\")
for day in d['weather']:
    print(f\"{day['date']}: High {day['maxtempC']}°C, Low {day['mintempC']}°C\")
"
```

### Weather with units
```bash
# Metric (Celsius, km/h) - default
curl -s "wttr.in/Chicago?format=4&m"

# US customary (Fahrenheit, mph)
curl -s "wttr.in/Chicago?format=4&u"
```

### Sunrise and sunset
```bash
curl -s "wttr.in/Oslo?format=%S+/+%s"
```

### Moon phase
```bash
curl -s "wttr.in/Moon?format=%m"
```

## Location Formats

wttr.in accepts many location formats:

| Input | Example |
|-------|---------|
| City name | `London`, `New+York`, `San+Francisco` |
| Airport code | `JFK`, `LHR`, `SYD` |
| Coordinates | `-33.8688,151.2093` |
| Domain/IP lookup | omit location for requester's IP |
| Landmark | `Eiffel+Tower`, `Statue+of+Liberty` |

Replace spaces with `+` in URLs.

## How to Fetch Weather

### Step 1: Extract the Location

Parse the location from the user's message:
- "weather in Tokyo" - location: `Tokyo`
- "is it raining in New York?" - location: `New+York`
- "what's the temperature" - no location; ask "Which city?" or use system location if available

### Step 2: Choose the Right Format

- Simple question ("what's the weather in X?") - use `format=4` for one clean line
- "Full forecast" or "this week" - use `format=j1` with the Python parser
- "Will it rain?" - use `format=j1`, check `precipMM` in hourly data
- "Feels like / humidity / wind" - use custom format string

### Step 3: Execute and Present

Run via the `exec` tool. Format the output conversationally:

Good response:
```
London right now: Partly Cloudy, 14°C (57°F), humidity 71%, wind 22 km/h NW.
This week: Rain expected Thursday, clearing by the weekend. High of 17°C on Saturday.
```

Not just raw output:
```
London: ⛅️ +14°C, 🌬️↗22km/h, 71%
```

### Step 4: Answer the Underlying Question

If the user asked "should I bring an umbrella?", don't just show the forecast - answer the question:
- "Yes - there is 80% chance of rain this afternoon and tomorrow morning."
- "No umbrella needed - dry and sunny through the weekend."

## Example Interactions

**User**: What's the weather in Paris?
**You**: *(runs `curl -s "wttr.in/Paris?format=4"`, formats output: "Paris: Overcast, 11°C (52°F), wind 15 km/h SW.")*

**User**: Will it rain in Tokyo this week?
**You**: *(runs JSON query, parses precipitation forecast, answers: "Light rain expected Tuesday and Wednesday (2-4 mm/day). Thursday onward looks clear.")*

**User**: What's the temperature difference between London and New York right now?
**You**: *(runs two parallel format=4 queries, compares temperatures, presents side-by-side)*

**User**: When does the sun set in Oslo today?
**You**: *(runs `curl -s "wttr.in/Oslo?format=%S+/+%s"`, returns "Sunrise: 05:47, Sunset: 21:12 (local time)")*

## Best Practices

1. **Always name the location** in your response - never just say "the weather is..."
2. **Convert units** when context suggests the user's locale (°C for most, °F for US)
3. **Answer the question, not just the data** - interpret forecast for the user's actual need
4. **Note the data freshness** - wttr.in updates every ~30 minutes; add "as of now" if precision matters
5. **Handle ambiguous locations** - if "Springfield" or similar, ask which state/country
6. **Graceful failure** - if wttr.in is unreachable, say so and suggest checking weather.com
