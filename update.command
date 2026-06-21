#!/bin/bash
# Move to the directory where this script is located
cd "$(dirname "$0")"

clear
echo "==============================================="
echo "       MChord Songbook Automatic Update        "
echo "==============================================="
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed or not in PATH."
    echo "Please install Node.js and npm first."
    echo ""
    echo "Press any key to close..."
    read -n 1
    exit 1
fi

# Run the update script
npm run update

echo ""
echo "==============================================="
echo "Update process finished."
echo "Press any key to close this terminal..."
read -n 1
