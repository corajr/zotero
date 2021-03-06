/**
 * Functions for performing HTTP requests, both via XMLHTTPRequest and using a hidden browser
 * @namespace
 */
Zotero.HTTP = new function() {
	Components.utils.import("resource://zotero/q.js");
	
	/**
	 * Exception returned for unexpected status when promise* is used
	 * @constructor
	 */
	this.UnexpectedStatusException = function(xmlhttp) {
		this.xmlhttp = xmlhttp;
		this.status = xmlhttp.status;
		this.message = "XMLHttpRequest received unexpected status "+this.status;
	};
	
	this.UnexpectedStatusException.prototype.toString = function() {
		return this.message;
	};
	
	/**
	 * Exception returned if the browser is offline when promise* is used
	 * @constructor
	 */
	this.BrowserOfflineException = function() {
		this.message = "XMLHttpRequest could not complete because the browser is offline";
	};
	this.BrowserOfflineException.prototype.toString = function() {
		return this.message;
	};
	
	/**
	 * Get a promise for a HTTP request
	 * 
	 * @param {String} method The method of the request ("GET", "POST", "HEAD", or "OPTIONS")
	 * @param {nsIURI|String}	url				URL to request
	 * @param {Object} [options] Options for HTTP request:<ul>
	 *         <li>body - The body of a POST request</li>
	 *         <li>responseType - The type of the response. See XHR 2 documentation for
	 *             legal values</li>
	 *         <li>responseCharset - The charset the response should be interpreted as</li>
	 *         <li>cookieSandbox - The sandbox from which cookies should be taken</li>
	 *         <li>dontCache - If set, specifies that the request should not be fulfilled
	 *             from the cache</li>
	 *     </ul>
	 * @param {Zotero.CookieSandbox} [cookieSandbox] Cookie sandbox object
	 * @return {Promise} A promise resolved with the XMLHttpRequest object if the request
	 *     succeeds, or rejected if the browser is offline or a non-2XX status response
	 *     code is received.
	 */
	this.promise = function promise(method, url, options) {
		if (url instanceof Components.interfaces.nsIURI) {
			// Don't display password in console
			var disp = url.clone();
			if (disp.password) {
				disp.password = "********";
			}
			url = url.spec;
		}
		
		if(options && options.body) {
			var bodyStart = options.body.substr(0, 1024);
			// Don't display sync password or session id in console
			bodyStart = bodyStart.replace(/password=[^&]+/, 'password=********');
			bodyStart = bodyStart.replace(/sessionid=[^&]+/, 'sessionid=********');
			
			Zotero.debug("HTTP "+method+" "
				+ (options.body.length > 1024 ?
					bodyStart + '... (' + options.body.length + ' chars)' : bodyStart)
				+ " to " + (disp ? disp.spec : url));
		} else {
			Zotero.debug("HTTP GET " + url);
		}
		
		if (this.browserIsOffline()) {
			return Q.fcall(function() {
				Zotero.debug("HTTP GET " + url + " failed: Browser is offline");
				throw new this.BrowserOfflineException();
			});
		}
		
		var xmlhttp = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
					.createInstance();
		// Prevent certificate/authentication dialogs from popping up
		xmlhttp.mozBackgroundRequest = true;
		xmlhttp.open(method, url, true);
		
		// Send cookie even if "Allow third-party cookies" is disabled (>=Fx3.6 only)
		var channel = xmlhttp.channel;
		channel.QueryInterface(Components.interfaces.nsIHttpChannelInternal);
		channel.forceAllowThirdPartyCookie = true;
		
		// Set charset
		if (options && options.responseCharset) {
			channel.contentCharset = responseCharset;
		}
		
		// Disable caching if requested
		if(options && options.dontCache) {
			channel.loadFlags |= Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE;
		}
		
		// Send headers
		var headers = {};
		if (options && options.body && !headers["Content-Type"]) {
			headers["Content-Type"] = "application/x-www-form-urlencoded";
		}
		for (var header in headers) {
			xmlhttp.setRequestHeader(header, headers[header]);
		}
		
		var deferred = Q.defer();
		
		xmlhttp.onloadend = function() {
			var status = xmlhttp.status;
			if(status >= 200 && status < 300) {
				Zotero.debug("HTTP GET " + url + " succeeded");
				deferred.resolve(xmlhttp);
			} else {
				Zotero.debug("HTTP GET " + url + " failed: Unexpected status code "+xmlhttp.status);
				deferred.reject(new Zotero.HTTP.UnexpectedStatusException(xmlhttp));
			}
		};
		
		if(options && options.cookieSandbox) {
			options.cookieSandbox.attachToInterfaceRequestor(xmlhttp);
		}
		
		xmlhttp.send((options && options.body) || null);
		
		return deferred.promise;
	};
	
	/**
	 * Send an HTTP GET request via XMLHTTPRequest
	 * 
	 * @param {nsIURI|String}	url				URL to request
	 * @param {Function} 		onDone			Callback to be executed upon request completion
	 * @param {String} 		responseCharset	Character set to force on the response
	 * @param {Zotero.CookieSandbox} [cookieSandbox] Cookie sandbox object
	 * @return {XMLHttpRequest} The XMLHttpRequest object if the request was sent, or
	 *     false if the browser is offline
	 * @deprecated Use {@link Zotero.HTTP.promise}
	 */
	this.doGet = function(url, onDone, responseCharset, cookieSandbox) {
		if (url instanceof Components.interfaces.nsIURI) {
			// Don't display password in console
			var disp = url.clone();
			if (disp.password) {
				disp.password = "********";
			}
			Zotero.debug("HTTP GET " + disp.spec);
			url = url.spec;
		}
		else {
			Zotero.debug("HTTP GET " + url);
		}
		if (this.browserIsOffline()){
			return false;
		}
		
		var xmlhttp = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
						.createInstance();
		
		// Prevent certificate/authentication dialogs from popping up
		xmlhttp.mozBackgroundRequest = true;
		xmlhttp.open('GET', url, true);
		
		// Send cookie even if "Allow third-party cookies" is disabled (>=Fx3.6 only)
		var channel = xmlhttp.channel;
		channel.QueryInterface(Components.interfaces.nsIHttpChannelInternal);
		channel.forceAllowThirdPartyCookie = true;
		
		// Set charset
		if (responseCharset) {
			channel.contentCharset = responseCharset;
		}
	
		// Don't cache GET requests
		xmlhttp.channel.loadFlags |= Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE;
		
		/** @ignore */
		xmlhttp.onreadystatechange = function() {
			_stateChange(xmlhttp, onDone, responseCharset);
		};
		
		if(cookieSandbox) cookieSandbox.attachToInterfaceRequestor(xmlhttp);
		xmlhttp.send(null);
		
		return xmlhttp;
	}
	
	/**
	 * Send an HTTP POST request via XMLHTTPRequest
	 *
	 * @param {String} url URL to request
	 * @param {String} body Request body
	 * @param {Function} onDone Callback to be executed upon request completion
	 * @param {String} headers Request HTTP headers
	 * @param {String} responseCharset Character set to force on the response
	 * @param {Zotero.CookieSandbox} [cookieSandbox] Cookie sandbox object
	 * @return {XMLHttpRequest} The XMLHttpRequest object if the request was sent, or
	 *     false if the browser is offline
	 * @deprecated Use {@link Zotero.HTTP.promise}
	 */
	this.doPost = function(url, body, onDone, headers, responseCharset, cookieSandbox) {
		if (url instanceof Components.interfaces.nsIURI) {
			// Don't display password in console
			var disp = url.clone();
			if (disp.password) {
				disp.password = "********";
			}
			url = url.spec;
		}
		
		var bodyStart = body.substr(0, 1024);
		// Don't display sync password or session id in console
		bodyStart = bodyStart.replace(/password=[^&]+/, 'password=********');
		bodyStart = bodyStart.replace(/sessionid=[^&]+/, 'sessionid=********');
		
		Zotero.debug("HTTP POST "
			+ (body.length > 1024 ?
				bodyStart + '... (' + body.length + ' chars)' : bodyStart)
			+ " to " + (disp ? disp.spec : url));
		
		
		if (this.browserIsOffline()){
			return false;
		}
		
		var xmlhttp = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
					.createInstance();
		// Prevent certificate/authentication dialogs from popping up
		xmlhttp.mozBackgroundRequest = true;
		xmlhttp.open('POST', url, true);
		// Send cookie even if "Allow third-party cookies" is disabled (>=Fx3.6 only)
		var channel = xmlhttp.channel;
		channel.QueryInterface(Components.interfaces.nsIHttpChannelInternal);
		channel.forceAllowThirdPartyCookie = true;
		
		// Set charset
		if (responseCharset) {
			channel.contentCharset = responseCharset;
		}
		
		if (headers) {
			if (typeof headers == 'string') {
				var msg = "doPost() now takes a headers object rather than a requestContentType -- update your code";
				Zotero.debug(msg, 2);
				Components.utils.reportError(msg);
				headers = {
					"Content-Type": headers
				};
			}
		}
		else {
			headers = {};
		}
		
		if (!headers["Content-Type"]) {
			headers["Content-Type"] = "application/x-www-form-urlencoded";
		}
		
		for (var header in headers) {
			xmlhttp.setRequestHeader(header, headers[header]);
		}
		
		/** @ignore */
		xmlhttp.onreadystatechange = function(){
			_stateChange(xmlhttp, onDone, responseCharset);
		};
		
		if(cookieSandbox) cookieSandbox.attachToInterfaceRequestor(xmlhttp);
		xmlhttp.send(body);
		
		return xmlhttp;
	}
	
	/**
	 * Send an HTTP HEAD request via XMLHTTPRequest
	 *
	 * @param {String} url URL to request
	 * @param {Function} onDone Callback to be executed upon request completion
	 * @param {Object} requestHeaders HTTP headers to include with request
	 * @param {Zotero.CookieSandbox} [cookieSandbox] Cookie sandbox object
	 * @return {XMLHttpRequest} The XMLHttpRequest object if the request was sent, or
	 *     false if the browser is offline
	 * @deprecated Use {@link Zotero.HTTP.promise}
	 */
	this.doHead = function(url, onDone, requestHeaders, cookieSandbox) {
		if (url instanceof Components.interfaces.nsIURI) {
			// Don't display password in console
			var disp = url.clone();
			if (disp.password) {
				disp.password = "********";
			}
			Zotero.debug("HTTP HEAD " + disp.spec);
			url = url.spec;
		}
		else {
			Zotero.debug("HTTP HEAD " + url);
		
		}
		
		if (this.browserIsOffline()){
			return false;
		}
		
		// Workaround for "Accept third-party cookies" being off in Firefox 3.0.1
		// https://www.zotero.org/trac/ticket/1070
		var xmlhttp = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
						.createInstance();
		// Prevent certificate/authentication dialogs from popping up
		xmlhttp.mozBackgroundRequest = true;
		xmlhttp.open('HEAD', url, true);
		// Send cookie even if "Allow third-party cookies" is disabled (>=Fx3.6 only)
		var channel = xmlhttp.channel;
		channel.QueryInterface(Components.interfaces.nsIHttpChannelInternal);
		channel.forceAllowThirdPartyCookie = true;
		
		if (requestHeaders) {
			for (var header in requestHeaders) {
				xmlhttp.setRequestHeader(header, requestHeaders[header]);
			}
		}
		
		// Don't cache HEAD requests
		xmlhttp.channel.loadFlags |= Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE;
		
		/** @ignore */
		xmlhttp.onreadystatechange = function(){
			_stateChange(xmlhttp, onDone);
		};
		
		if(cookieSandbox) cookieSandbox.attachToInterfaceRequestor(xmlhttp);
		xmlhttp.send(null);
		
		return xmlhttp;
	}
	
	/**
	 * Send an HTTP OPTIONS request via XMLHTTPRequest
	 *
	 * @param	{nsIURI}		url
	 * @param	{Function}	onDone
	 * @return	{XMLHTTPRequest}
	 * @deprecated Use {@link Zotero.HTTP.promise}
	 */
	this.doOptions = function (uri, callback) {
		// Don't display password in console
		var disp = uri.clone();
		if (disp.password) {
			disp.password = "********";
		}
		Zotero.debug("HTTP OPTIONS for " + disp.spec);
		
		if (Zotero.HTTP.browserIsOffline()){
			return false;
		}
		
		var xmlhttp = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
					.createInstance();
		// Prevent certificate/authentication dialogs from popping up
		xmlhttp.mozBackgroundRequest = true;
		xmlhttp.open('OPTIONS', uri.spec, true);
		/** @ignore */
		xmlhttp.onreadystatechange = function() {
			_stateChange(xmlhttp, callback);
		};
		xmlhttp.send(null);
		return xmlhttp;
	}
	
	//
	// WebDAV methods
	//
	
	this.WebDAV = {};
	
	/**
	* Send a WebDAV PROP* request via XMLHTTPRequest
	*
	* Returns false if browser is offline
	*
	* @param		{String}		method			PROPFIND or PROPPATCH
	* @param		{nsIURI}		uri
	* @param		{String}		body				XML string
	* @param		{Function}	callback
	* @param		{Object}		requestHeaders	e.g. { Depth: 0 }
	*/
	this.WebDAV.doProp = function (method, uri, body, callback, requestHeaders) {
		switch (method) {
			case 'PROPFIND':
			case 'PROPPATCH':
				break;
			
			default:
				throw ("Invalid method '" + method
					+ "' in Zotero.HTTP.doProp");
		}
		
		if (requestHeaders && requestHeaders.depth != undefined) {
			var depth = requestHeaders.depth;
		}
		
		// Don't display password in console
		var disp = uri.clone();
		if (disp.password) {
			disp.password = "********";
		}
		
		var bodyStart = body.substr(0, 1024);
		Zotero.debug("HTTP " + method + " "
			+ (depth != undefined ? "(depth " + depth + ") " : "")
			+ (body.length > 1024 ?
				bodyStart + "... (" + body.length + " chars)" : bodyStart)
			+ " to " + disp.spec);
		
		if (Zotero.HTTP.browserIsOffline()) {
			Zotero.debug("Browser is offline", 2);
			return false;
		}
		
		var xmlhttp = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
						.createInstance();
		// Prevent certificate/authentication dialogs from popping up
		xmlhttp.mozBackgroundRequest = true;
		xmlhttp.open(method, uri.spec, true);
		
		if (requestHeaders) {
			for (var header in requestHeaders) {
				xmlhttp.setRequestHeader(header, requestHeaders[header]);
			}
		}
		
		xmlhttp.setRequestHeader("Content-Type", 'text/xml; charset="utf-8"');
		
		xmlhttp.onreadystatechange = function() {
			_stateChange(xmlhttp, callback);
		};
		
		xmlhttp.send(body);
		return xmlhttp;
	}
	
	
	/**
	 * Send a WebDAV MKCOL request via XMLHTTPRequest
	 *
	 * @param	{nsIURI}		url
	 * @param	{Function}	onDone
	 * @return	{XMLHTTPRequest}
	 */
	this.WebDAV.doMkCol = function (uri, callback) {
		// Don't display password in console
		var disp = uri.clone();
		if (disp.password) {
			disp.password = "********";
		}
		Zotero.debug("HTTP MKCOL " + disp.spec);
		
		if (Zotero.HTTP.browserIsOffline()) {
			return false;
		}
		
		var xmlhttp = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
					.createInstance();
		// Prevent certificate/authentication dialogs from popping up
		xmlhttp.mozBackgroundRequest = true;
		xmlhttp.open('MKCOL', uri.spec, true);
		xmlhttp.onreadystatechange = function() {
			_stateChange(xmlhttp, callback);
		};
		xmlhttp.send(null);
		return xmlhttp;
	}
	
	
	/**
	 * Send a WebDAV PUT request via XMLHTTPRequest
	 *
	 * @param	{nsIURI}		url
	 * @param	{String}		body			String body to PUT
	 * @param	{Function}	onDone
	 * @return	{XMLHTTPRequest}
	 */
	this.WebDAV.doPut = function (uri, body, callback) {
		// Don't display password in console
		var disp = uri.clone();
		if (disp.password) {
			disp.password = "********";
		}
		
		var bodyStart = "'" + body.substr(0, 1024) + "'";
		Zotero.debug("HTTP PUT "
			+ (body.length > 1024 ?
				bodyStart + "... (" + body.length + " chars)" : bodyStart)
			+ " to " + disp.spec);
		
		if (Zotero.HTTP.browserIsOffline()) {
			return false;
		}
		
		var xmlhttp = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
					.createInstance();
		// Prevent certificate/authentication dialogs from popping up
		xmlhttp.mozBackgroundRequest = true;
		xmlhttp.open("PUT", uri.spec, true);
		// Some servers (e.g., Jungle Disk DAV) return a 200 response code
		// with Content-Length: 0, which triggers a "no element found" error
		// in Firefox, so we override to text
		xmlhttp.overrideMimeType("text/plain");
		xmlhttp.onreadystatechange = function() {
			_stateChange(xmlhttp, callback);
		};
		xmlhttp.send(body);
		return xmlhttp;
	}
	
	
	/**
	 * Send a WebDAV PUT request via XMLHTTPRequest
	 *
	 * @param	{nsIURI}		url
	 * @param	{Function}	onDone
	 * @return	{XMLHTTPRequest}
	 */
	this.WebDAV.doDelete = function (uri, callback) {
		// Don't display password in console
		var disp = uri.clone();
		if (disp.password) {
			disp.password = "********";
		}
		
		Zotero.debug("WebDAV DELETE to " + disp.spec);
		
		if (Zotero.HTTP.browserIsOffline()) {
			return false;
		}
		
		var xmlhttp = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
					.createInstance();
		// Prevent certificate/authentication dialogs from popping up
		xmlhttp.mozBackgroundRequest = true;
		xmlhttp.open("DELETE", uri.spec, true);
		// Firefox 3 throws a "no element found" error even with a
		// 204 ("No Content") response, so we override to text
		xmlhttp.overrideMimeType("text/plain");
		xmlhttp.onreadystatechange = function() {
			_stateChange(xmlhttp, callback);
		};
		xmlhttp.send(null);
		return xmlhttp;
	}
	
	
	/**
	 * Get the Authorization header used by a channel
	 *
	 * As of Firefox 3.0.1 subsequent requests to higher-level directories
	 * seem not to authenticate properly and just return 401s, so this
	 * can be used to manually include the Authorization header in a request
	 *
	 * It can also be used to check whether a request was forced to
	 * use authentication
	 *
	 * @param	{nsIChannel}		channel
	 * @return	{String|FALSE}				Authorization header, or FALSE if none
	 */
	this.getChannelAuthorization = function (channel) {
		try {
			channel.QueryInterface(Components.interfaces.nsIHttpChannel);
			var authHeader = channel.getRequestHeader("Authorization");
			return authHeader;
		}
		catch (e) {
			Zotero.debug(e);
			return false;
		}
	}
	
	
	/**
	 * Checks if the browser is currently in "Offline" mode
	 *
	 * @type Boolean
	 */
	this.browserIsOffline = function() { 
		return Components.classes["@mozilla.org/network/io-service;1"]
			.getService(Components.interfaces.nsIIOService).offline;
	}
	
	/**
	 * Load one or more documents in a hidden browser
	 *
	 * @param {String|String[]} urls URL(s) of documents to load
	 * @param {Function} processor Callback to be executed for each document loaded
	 * @param {Function} done Callback to be executed after all documents have been loaded
	 * @param {Function} exception Callback to be executed if an exception occurs
	 * @param {Boolean} dontDelete Don't delete the hidden browser upon completion; calling function
	 *                             must call deleteHiddenBrowser itself.
	 * @param {Zotero.CookieSandbox} [cookieSandbox] Cookie sandbox object
	 * @return {browser} Hidden browser used for loading
	 */
	this.processDocuments = function(urls, processor, done, exception, dontDelete, cookieSandbox) {
		// (Approximately) how many seconds to wait if the document is left in the loading state and
		// pageshow is called before we call pageshow with an incomplete document
		const LOADING_STATE_TIMEOUT = 120;
		
		var firedLoadEvent;
		/**
		 * Removes event listener for the load event and deletes the hidden browser
		 */
		var removeListeners = function() {
			hiddenBrowser.removeEventListener(loadEvent, onLoad, true);
			if(!dontDelete) Zotero.Browser.deleteHiddenBrowser(hiddenBrowser);
		}
		
		/**
		 * Loads the next page
		 * @inner
		 */
		var doLoad = function() {
			if(urls.length) {
				var url = urls.shift();
				firedLoadEvent = 0;
				try {
					Zotero.debug("loading "+url);
					hiddenBrowser.loadURI(url);
				} catch(e) {
					removeListeners();
					if(exception) {
						exception(e);
						return;
					} else {
						throw(e);
					}
				}
			} else {
				removeListeners();
				if(done) done();
			}
		};
		
		/**
		 * Callback to be executed when a page load completes
		 * @inner
		 */
		var onLoad = function() {
			var doc = hiddenBrowser.contentDocument,
				url = doc.location.href.toString();
			if(url == "about:blank") return;
			if(doc.readyState === "loading" && firedLoadEvent < 120) {
				// Try again in a second	
				firedLoadEvent++;
				Zotero.setTimeout(onLoad, 1000);
				return;
			}
			if(url !== prevUrl) {	// Just in case it fires too many times
				prevUrl = url;
				try {
					processor(doc);
				} catch(e) {
					removeListeners();
					if(exception) {
						exception(e);
						return;
					} else {
						throw(e);
					}
				}
				doLoad();
			}
		};
		
		if(typeof(urls) == "string") urls = [urls];
		
		var prevUrl;
		var loadEvent = "pageshow";
		
		var hiddenBrowser = Zotero.Browser.createHiddenBrowser();
		hiddenBrowser.addEventListener(loadEvent, onLoad, true);
		if(cookieSandbox) cookieSandbox.attachToBrowser(hiddenBrowser);
		
		doLoad();
		
		return hiddenBrowser;
	}
	
	/**
	 * Handler for XMLHttpRequest state change
	 *
	 * @param {nsIXMLHttpRequest} XMLHttpRequest whose state just changed
	 * @param {Function} [onDone] Callback for request completion
	 * @param {String} [responseCharset] Character set to force on the response
	 * @private
	 */
	function _stateChange(xmlhttp, callback, responseCharset, data) {
		switch (xmlhttp.readyState){
			// Request not yet made
			case 1:
				break;
			
			case 2:
				break;
			
			// Called multiple times while downloading in progress
			case 3:
				break;
			
			// Download complete
			case 4:
				if (callback) {
					// Override the content charset
					if (responseCharset) {
						xmlhttp.channel.contentCharset = responseCharset;
					}
					callback(xmlhttp, data);
				}
			break;
		}
	}
}