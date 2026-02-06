#!/usr/bin/env python3
"""
GLINR API Testing Framework

A reusable Python framework for testing GLINR chat API endpoints.
Supports conversation management, tool testing, and prompt validation.

Usage:
    # As a library
    from glinr_test import GlinrClient

    client = GlinrClient()
    conv_id = client.create_conversation("Test Session")
    response = client.send_message_with_tools(conv_id, "Create a ticket")
    print(response.tool_calls)

    # From command line
    python glinr_test.py --test all
    python glinr_test.py --test tools --message "List files in src/"
"""

import json
import os
import sys
import time
import argparse
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from pathlib import Path
import requests

# Configuration
DEFAULT_BASE_URL = "http://localhost:3000"
DEFAULT_MODEL = "gpt4o-mini"  # Azure GPT-4o Mini - supports tool calling
STATE_FILE = Path(__file__).parent / ".test-state.json"


@dataclass
class ToolCall:
    """Represents a tool call made by the AI"""
    id: str
    name: str
    arguments: Dict[str, Any]
    result: Optional[Any] = None
    status: str = "unknown"


@dataclass
class ChatResponse:
    """Represents a chat API response"""
    content: str
    model: str
    provider: str
    tool_calls: List[ToolCall] = field(default_factory=list)
    usage: Optional[Dict[str, int]] = None
    raw_response: Dict[str, Any] = field(default_factory=dict)


class GlinrClient:
    """Client for GLINR API testing"""

    def __init__(self, base_url: Optional[str] = None, model: Optional[str] = None):
        self.base_url = base_url or os.environ.get("GLINR_BASE_URL", DEFAULT_BASE_URL)
        self.api_url = f"{self.base_url}/api"
        self.model = model or os.environ.get("GLINR_MODEL", DEFAULT_MODEL)
        self.state = self._load_state()

    def _load_state(self) -> Dict[str, Any]:
        """Load state from file"""
        if STATE_FILE.exists():
            return json.loads(STATE_FILE.read_text())
        return {}

    def _save_state(self):
        """Save state to file"""
        STATE_FILE.write_text(json.dumps(self.state, indent=2))

    def _request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Dict:
        """Make API request"""
        url = f"{self.api_url}{endpoint}"
        headers = {"Content-Type": "application/json"}

        try:
            if method == "GET":
                resp = requests.get(url, headers=headers)
            elif method == "POST":
                resp = requests.post(url, headers=headers, json=data or {})
            elif method == "DELETE":
                resp = requests.delete(url, headers=headers)
            else:
                raise ValueError(f"Unknown method: {method}")

            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.ConnectionError:
            raise ConnectionError(f"Cannot connect to {self.base_url}. Is the server running?")

    # =========================================================================
    # Server Health
    # =========================================================================

    def check_health(self) -> bool:
        """Check if server is running"""
        try:
            requests.get(f"{self.base_url}/health", timeout=2)
            return True
        except:
            return False

    # =========================================================================
    # Conversation Management
    # =========================================================================

    def create_conversation(self, title: str = "API Test Session") -> str:
        """Create a new conversation and return its ID"""
        result = self._request("POST", "/chat/conversations", {
            "title": title,
            "presetId": "glinr-assistant"
        })
        conv_id = result["conversation"]["id"]
        self.state["conversationId"] = conv_id
        self.state["createdAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        self._save_state()
        return conv_id

    def get_or_create_conversation(self) -> str:
        """Get existing conversation or create new one"""
        conv_id = self.state.get("conversationId")
        if conv_id:
            # Verify it exists
            try:
                self._request("GET", f"/chat/conversations/{conv_id}")
                return conv_id
            except:
                pass
        return self.create_conversation()

    def delete_conversation(self, conv_id: str):
        """Delete a conversation"""
        self._request("DELETE", f"/chat/conversations/{conv_id}")
        if self.state.get("conversationId") == conv_id:
            del self.state["conversationId"]
            self._save_state()

    # =========================================================================
    # Chat Methods
    # =========================================================================

    def send_message(self, conv_id: str, content: str, model: Optional[str] = None) -> ChatResponse:
        """Send a simple message without tools"""
        result = self._request("POST", f"/chat/conversations/{conv_id}/messages", {
            "content": content,
            "model": model or self.model
        })
        return ChatResponse(
            content=result["assistantMessage"]["content"],
            model=result["assistantMessage"].get("model", "unknown"),
            provider=result["assistantMessage"].get("provider", "unknown"),
            usage=result.get("usage"),
            raw_response=result
        )

    def send_message_with_tools(
        self,
        conv_id: str,
        content: str,
        enable_tools: bool = True,
        model: Optional[str] = None
    ) -> ChatResponse:
        """Send a message with tool calling enabled"""
        result = self._request("POST", f"/chat/conversations/{conv_id}/messages/with-tools", {
            "content": content,
            "enableTools": enable_tools,
            "model": model or self.model
        })

        # Parse tool calls
        tool_calls = []
        for tc in result.get("toolCalls", []):
            tool_calls.append(ToolCall(
                id=tc["id"],
                name=tc["name"],
                arguments=tc.get("arguments", {}),
                result=tc.get("result"),
                status=tc.get("status", "unknown")
            ))

        return ChatResponse(
            content=result["assistantMessage"]["content"],
            model=result["assistantMessage"].get("model", "unknown"),
            provider=result["assistantMessage"].get("provider", "unknown"),
            tool_calls=tool_calls,
            usage=result.get("usage"),
            raw_response=result
        )

    def list_tools(self, all_tools: bool = False) -> List[Dict[str, str]]:
        """List available chat tools"""
        endpoint = "/chat/tools?all=true" if all_tools else "/chat/tools"
        result = self._request("GET", endpoint)
        return result.get("tools", [])


class TestRunner:
    """Run test scenarios"""

    def __init__(self, client: GlinrClient):
        self.client = client
        self.results = []

    def _log(self, msg: str, level: str = "info"):
        colors = {
            "info": "\033[94m",  # Blue
            "success": "\033[92m",  # Green
            "warn": "\033[93m",  # Yellow
            "error": "\033[91m",  # Red
        }
        reset = "\033[0m"
        color = colors.get(level, "")
        prefix = {"info": "[INFO]", "success": "[OK]", "warn": "[WARN]", "error": "[ERROR]"}.get(level, "[?]")
        print(f"{color}{prefix}{reset} {msg}")

    def run_test(self, name: str, test_func) -> bool:
        """Run a single test"""
        print(f"\n{'='*50}")
        print(f"Test: {name}")
        print(f"{'='*50}\n")

        try:
            result = test_func()
            self.results.append((name, True, result))
            self._log(f"Test passed: {name}", "success")
            return True
        except Exception as e:
            self.results.append((name, False, str(e)))
            self._log(f"Test failed: {name} - {e}", "error")
            return False

    def test_health(self) -> Dict:
        """Test server health"""
        if not self.client.check_health():
            raise Exception("Server not running")
        return {"status": "healthy"}

    def test_simple_chat(self, message: str = "Hello, how are you?") -> Dict:
        """Test simple chat without tools"""
        conv_id = self.client.get_or_create_conversation()
        self._log(f"Using conversation: {conv_id}")

        response = self.client.send_message(conv_id, message)
        self._log(f"Response ({response.model}): {response.content[:100]}...")

        return {
            "model": response.model,
            "content_length": len(response.content),
            "has_response": len(response.content) > 0
        }

    def test_tools_available(self) -> Dict:
        """Test that tools are available"""
        tools = self.client.list_tools()
        self._log(f"Found {len(tools)} tools")

        # Check for essential tools
        tool_names = [t["name"] for t in tools]
        essential = ["create_ticket", "read_file", "exec"]
        missing = [t for t in essential if t not in tool_names]

        if missing:
            self._log(f"Missing essential tools: {missing}", "warn")

        return {
            "total_tools": len(tools),
            "tool_names": tool_names[:10],
            "has_create_ticket": "create_ticket" in tool_names
        }

    def test_tool_calling(self, message: str = "What files are in the current directory?") -> Dict:
        """Test that tool calling works"""
        conv_id = self.client.get_or_create_conversation()
        self._log(f"Message: {message}")

        response = self.client.send_message_with_tools(conv_id, message)

        tool_count = len(response.tool_calls)
        self._log(f"Tool calls made: {tool_count}")

        for tc in response.tool_calls:
            self._log(f"  - {tc.name}: {tc.status}")

        return {
            "tool_calls": tool_count,
            "tools_used": [tc.name for tc in response.tool_calls],
            "any_success": any(tc.status == "success" for tc in response.tool_calls)
        }

    def test_create_ticket(self) -> Dict:
        """Test ticket creation flow - single-step tool calling

        Note: For full ticket creation (list_projects -> create_ticket),
        use the agentic endpoint via test-agentic.sh. The single-step endpoint
        correctly calls list_projects first to find available projects.
        """
        conv_id = self.client.get_or_create_conversation()
        message = "Create a ticket titled 'API Test Ticket' with description 'Testing ticket creation via API'"

        self._log(f"Message: {message}")
        response = self.client.send_message_with_tools(conv_id, message)

        # In single-step mode, model correctly calls list_projects first
        # (needs to know which project to create ticket in)
        # For full multi-step flow, use agentic endpoint
        tool_calls = response.tool_calls

        if not tool_calls:
            raise Exception("No tool calls made - expected list_projects or create_ticket")

        # Accept either list_projects (first step) or create_ticket (direct)
        valid_tools = ["list_projects", "create_ticket"]
        first_tool = tool_calls[0].name

        if first_tool not in valid_tools:
            raise Exception(f"Unexpected first tool: {first_tool}, expected one of {valid_tools}")

        self._log(f"First tool called: {first_tool}")
        self._log(f"Status: {tool_calls[0].status}")

        if first_tool == "list_projects":
            self._log("Note: list_projects is correct first step - use agentic endpoint for full flow", "warn")

        return {
            "first_tool": first_tool,
            "tool_count": len(tool_calls),
            "status": tool_calls[0].status,
            "arguments": tool_calls[0].arguments
        }

    def run_all(self) -> bool:
        """Run all tests"""
        tests = [
            ("Server Health", self.test_health),
            ("Tools Available", self.test_tools_available),
            ("Simple Chat", self.test_simple_chat),
            ("Tool Calling", self.test_tool_calling),
            ("Create Ticket Flow", self.test_create_ticket),
        ]

        passed = 0
        failed = 0

        for name, func in tests:
            if self.run_test(name, func):
                passed += 1
            else:
                failed += 1

        print(f"\n{'='*50}")
        print(f"Results: {passed} passed, {failed} failed")
        print(f"{'='*50}")

        return failed == 0


def main():
    parser = argparse.ArgumentParser(description="GLINR API Testing")
    parser.add_argument("--base-url", help="API base URL", default=DEFAULT_BASE_URL)
    parser.add_argument("--model", help="Model to use (e.g., sonnet, gpt)", default=DEFAULT_MODEL)
    parser.add_argument("--test", choices=["all", "health", "chat", "tools", "ticket"],
                        default="all", help="Test to run")
    parser.add_argument("--message", help="Custom message for chat tests")

    args = parser.parse_args()

    client = GlinrClient(args.base_url, args.model)
    runner = TestRunner(client)

    if not client.check_health():
        print(f"\033[91m[ERROR]\033[0m Cannot connect to {args.base_url}")
        print("Start the server with: pnpm dev")
        sys.exit(1)

    if args.test == "all":
        success = runner.run_all()
        sys.exit(0 if success else 1)
    elif args.test == "health":
        runner.run_test("Health", runner.test_health)
    elif args.test == "chat":
        msg = args.message or "Hello, how are you?"
        runner.run_test("Chat", lambda: runner.test_simple_chat(msg))
    elif args.test == "tools":
        msg = args.message or "List files in the current directory"
        runner.run_test("Tools", lambda: runner.test_tool_calling(msg))
    elif args.test == "ticket":
        runner.run_test("Create Ticket", runner.test_create_ticket)


if __name__ == "__main__":
    main()
