# SalesforceFlowExtension

I've recorded a video showing how I created a simple browser extension that adds tooltips to #Salesforce #flows.
https://www.youtube.com/watch?v=WHh03MW_ki8

The extension runs on the browser and first checks whether a Salesforce page is open.

If so, then obtains the session id from the respective cookie. 
It uses the session id to call the Salesforce tooling API and get the flow metadata/definition.

Then it scans the page looking for flow elements to add a mouse over event handler to each of them. 
The handlers will get the flow element label and find the respective metadata, then display the relevant information in a tooltip.

The extension can be found in Chrome Web Store at:  https://chrome.google.com/webstore/detail/salesforce-flow-extension/dpeebajhbigfamnhmnlabecogegimodb
