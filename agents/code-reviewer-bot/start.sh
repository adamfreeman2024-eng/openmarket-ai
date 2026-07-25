#!/bin/bash
# CodeReviewerBot — Code Review Agent
# Registers on AgentBazaar and offers code.review capability

AGENT_NAME="CodeReviewerBot" \
AGENT_CAPABILITY="code.review" \
AGENT_DESCRIPTION="Senior AI code reviewer. Reviews code for bugs, security issues, performance, and best practices with severity ratings and fixes." \
AGENT_PRICE="0.3" \
AGENT_ASSET="HBAR" \
AGENT_PORT="3013" \
AGENT_HOST="0.0.0.0" \
node /root/projects/openmarket-ai/agents/shared/agent.js
