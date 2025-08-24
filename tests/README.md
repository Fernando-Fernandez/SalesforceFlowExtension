# Salesforce Flow Extension Tests

This directory contains Jest tests for the Salesforce Flow Extension functionality.

## Setup

1. Navigate to the tests directory:
   ```bash
   cd tests
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run tests:
   ```bash
   npm test
   ```

## Available Scripts

- `npm test` - Run all tests once
- `npm run test:watch` - Run tests in watch mode (re-runs on file changes)
- `npm run test:coverage` - Run tests with coverage report

## Test Structure

### `api-logic.test.js`
Tests for the core API logic including:
- Model detection (GPT-5 vs other models)
- API parameter selection (temperature, token limits, etc.)
- Payload generation for different model types
- Endpoint selection based on model type

### `response-parsing.test.js`
Tests for API response parsing including:
- GPT-5 response structure (`output.content.text`)
- Standard response structure (`choices[0].message.content`)
- Error handling for both response types
- Truncation detection and messaging

### `dom-interactions.test.js`
Tests for DOM manipulation and UI interactions including:
- Model selection UI creation and behavior
- LocalStorage integration for model persistence
- Event handling for radio buttons and custom input
- Error handling for missing DOM elements

## Key Features Tested

### Model Detection
- ✅ Correctly identifies GPT-5 models by name pattern
- ✅ Handles case sensitivity and edge cases
- ✅ Distinguishes between GPT-5 and other models

### API Integration
- ✅ Uses correct endpoints for different model types
- ✅ Generates proper payload structures
- ✅ Applies correct parameters (temperature, token limits)
- ✅ Excludes unsupported parameters for GPT-5

### Response Handling
- ✅ Parses GPT-5 responses with `output.content.text`
- ✅ Parses standard responses with `choices[0].message.content`
- ✅ Detects truncation via different mechanisms
- ✅ Handles API errors gracefully

### UI Components
- ✅ Model selection interface works correctly
- ✅ Custom model input shows/hides appropriately
- ✅ LocalStorage integration persists user choices
- ✅ Event handling works as expected

## Coverage

The tests aim for comprehensive coverage of:
- Core logic functions
- Error handling paths
- Edge cases and boundary conditions
- UI interaction patterns

## Running Tests

### Basic Test Run
```bash
npm test
```

### Watch Mode (for development)
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

## Adding New Tests

When adding new functionality to the extension:

1. Add unit tests for core logic in appropriate test files
2. Add integration tests if the feature involves multiple components
3. Test both happy path and error scenarios
4. Include edge cases and boundary conditions
5. Update this README if adding new test files

## Test Environment

Tests run in a Jest environment with:
- JSDOM for DOM manipulation testing
- Mocked browser APIs (localStorage, XMLHttpRequest, etc.)
- Mocked console methods to reduce test noise
- TextEncoder/TextDecoder mocks for crypto functionality