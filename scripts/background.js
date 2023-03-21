
const GETHOSTANDSESSION = "getHostSession";

// message handler to retrieve host and session id from Salesforce cookies
chrome.runtime.onMessage.addListener( ( message, sender, responseCallback ) => {
    if( message.message == GETHOSTANDSESSION ) {
        getHostAndSession( message, sender, responseCallback );
        return true;
    }

    return false;
});


function getHostAndSession( message, sender, responseCallback ) {
    // first, get org id from unsecure cookie
    let cookieDetails = { name: "sid"
                        , url: message.url
                        , storeId: sender.tab.cookieStoreId 
                    };
    chrome.cookies.get( cookieDetails, cookie => {
        if( ! cookie ) {
            responseCallback( null );
            return;
        }

        // try getting all secure cookies from salesforce.com and find the one matching our org id
        // (we may have more than one org open in different tabs or cookies from past orgs/sessions)
        let [ orgId ] = cookie.value.split( "!" );
        let secureCookieDetails = { name: "sid"
                                    , domain: "salesforce.com"
                                    , secure: true
                                    , storeId: sender.tab.cookieStoreId 
                                };
        chrome.cookies.getAll( secureCookieDetails, cookies => {
            // find the cookie for our org
            let sessionCookie = cookies.find( c => c.value.startsWith( orgId + "!" ) );
            if( ! sessionCookie ) {
                responseCallback( null );
                return;
            }
                
            responseCallback( { domain: sessionCookie.domain 
                                , session:  sessionCookie.value
                            } );
        });
    });
}