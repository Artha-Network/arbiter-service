# Arbiter Service

The AI-powered arbitration service for the Artha Network.

## Overview
This service acts as an automated arbiter for escrow disputes. It analyzes evidence submitted by both parties and makes a decision based on predefined rules and LLM analysis.

## Tech Stack
- **Runtime**: Node.js (TypeScript)
- **AI Model**: Google Gemini
- **Integration**: Solana Web3.js (for executing dispute resolution transactions)

## Setup
1. Copy `.env.example` to `.env` and configure your Gemini API key.
2. Run `npm install` to install dependencies.
3. Run `npm start` to run the service.

## Key Files
- `src/gemini-arbiter.ts`: Main service logic.
- `src/prompts`: System prompts for the AI model.
