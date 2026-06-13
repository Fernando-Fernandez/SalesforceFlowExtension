zip -r SalesforceFlowExtension.zip manifest.json LICENSE README.md rules.json popup.* scripts/ images/

# THIS WAS REPLACED WITH DEPLOYMENT VIA .CRX FILE
# A .crx is a signed zipped extension package. 
#
# TO GENERATE A .CRX FILE:
#
# Use Chrome UI
# Unzip your extension zip into a folder.
# Open Chrome.
# Go to: chrome://extensions
# Enable Developer mode.
# Click Pack extension.
# For Extension root directory, select the unzipped folder containing manifest.json.
# Selec the Private key file in the SalesforceFlowExtensionCert folder.
# Click Pack extension.
# 
# Chrome will create:
# your-extension.crx
# your-extension.pem (if you left private key file blank - keep it safe!)