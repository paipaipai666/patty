# Contributing to Patty

Thank you for your interest in contributing to Patty! This document provides guidelines and instructions for contributing.

## How to Contribute

### Reporting Bugs

1. Check existing [issues](https://github.com/paipaipai666/patty/issues) to avoid duplicates
2. Use the [Bug Report](https://github.com/paipaipai666/patty/issues/new?template=bug_report.yml) template
3. Include detailed steps to reproduce the issue
4. Add screenshots if applicable

### Suggesting Features

1. Check existing [issues](https://github.com/paipaipai666/patty/issues) to avoid duplicates
2. Use the [Feature Request](https://github.com/paipaipai666/patty/issues/new?template=feature_request.yml) template
3. Describe the problem and your proposed solution

### Submitting Changes

1. Fork the repository
2. Create a new branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Test your changes: `npm run dev`
5. Commit your changes: `git commit -m "Add your feature"`
6. Push to your fork: `git push origin feature/your-feature`
7. Create a Pull Request

## Development Setup

```bash
# Clone your fork
git clone https://github.com/paipaipai666/patty.git
cd patty

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

## Code Style

- Use TypeScript for all new code
- Follow existing code conventions
- Use CSS Modules for styling
- Keep components small and focused

## Project Structure

```
src/
├── main/          # Electron main process
├── preload/       # Preload scripts
├── renderer/      # React application
│   ├── components/
│   ├── store/
│   └── styles/
└── shared/        # Shared types
```

## Questions?

Feel free to open an issue for any questions about contributing.
