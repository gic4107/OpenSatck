var http = require("http");
var express = require("express");
var os = require('os');

var OSApi = require("./lib/osapi");
var ACS = require("./lib/ACS.min.js");

///-------------- module info --------------///

var moduleInfo = {
	port: 3001,
	path: '/api/process',
	name: 'osteam5_module'    // CHANGE THIS: name of the your module in format osteamX_module
};

///-------------- processing methods --------------///
var acsEngine = new ACS();

function processTask(data, numOfResults){

	var results = acsEngine.run(data, numOfResults);

	return results;
}

///-------------- load balancing --------------///

var instanceId = 2;
// Use the following parameters for the API:

var cli = new OSApi({
	name: "api_client",
	novaUrl: "http://192.168.1.151:8774/v2/cfe479a4e6154c61b74430d3fb67968a",	// CHANGE THIS: Compute url endpoint, done
	keystoneUrl: "http://192.168.1.151:5000/v2.0"								// CHANGE THIS: Identity url endpoint, done
});

var snapshotName = "osteam5_snapshot1";		// CHANGE THIS: name of the snapshot image
var	instanceName = "osteam5_instance";		// CHANGE THIS: new instance name
var	keypairName = "osteam5_keypair";		// CHANGE THIS: name of access keypair (can be the same for all instances)

var userInfo = {
	tenantName: "osteam5",		// CHANGE THIS: your OpenStack project name (same as the username in this case)
	username: "osteam5",		// CHANGE THIS: your group's name
	password: "osteam5"			// CHANGE THIS: your group's password
};

var mainInstanceAddr = '50.50.5.2';		// CHANGE THIS: local IP address of your main (first) instance, done

/**
 *  NOTE: you can use this in launchInstance() code to save floating IP addresses 
 *  which are already selected for association. Eg.:
 *     (see GET v2/​{tenant_id}​/os-floating-ips Compute API for response format: http://api.openstack.org/api-ref-compute.html#os-floating-ips
 *     
 *     if(floating_ips[i].instance_id === null && !usedFloatingIpAddr[floating_ips[i].ip]){
 * 	   		// use floating_ips[i].ip for the association
 *			usedFloatingIpAddr[floating_ips[i].ip] = true;
 *     }
 */
var usedFloatingIpAddr = {};

function hasAddress(address) {
	var ifaces = os.networkInterfaces(),
		key, i, len, iface, details;

	for(key in ifaces){
		iface = ifaces[key];
		len = iface.length;
		for(i=0; i<len; i++){
			details = iface[i];
			if(details.family === 'IPv4' && details.address === address) return true;
		}
	}
	return false;
}

function launchInstance(){
	var instanceParams = {
		instanceName : instanceName + instanceId++, // add counter to make different ending numbers in the name of each new instance	
		keypairName : keypairName,
	};
	
	cli.acquireToken(userInfo, function(err, token){
		if(err) return console.log("error: " + err);

		cli.getImages(function(err, images){
			// check for errors
			if(err) return console.log("error: " + err);

			// find the ID of the snapshot image based of imageName
			// if found write it in instanceParams.imageId
			var i, len=images.length;
			for(i=0; i<len; i++) {
//				console.log("image=" + images[i].name);
				if(images[i].name === snapshotName) 
					instanceParams.imageId = images[i].id;
			}

			// check if it actualy has the value:
			if(!instanceParams.imageId) return console.log("Failed to get specified image ID");

			// launch instance with instanceParams
			cli.launchInstance(instanceParams, function(err, instance) { 
				// save the id of the created instance (from the response of launchInstance API)
				var instanceId = instance.id;
//				console.log("instanceId= " + instanceId);
				if(err) return console.log("error: " + err);
//				console.log("launchInstance ...");	
				setTimeout(function(){

				}, 100000);
				// get the list of available floating IP addresses
				cli.getFloatingIps(function(err, floating_ips) {
					var i, len=floating_ips.length;
					// find a free (not associated with any instance) one
					for(i=0; i<len; i++) {
			//			if(floating_ips[i].instance_id === null) {
			  			if(floating_ips[i].instance_id === null && !usedFloatingIpAddr[floating_ips[i].ip]){
                       					usedFloatingIpAddr[floating_ips[i].ip] = true;
							var floatingIpParams = {
								instanceId : instance.id,
								floatingIpAddress : floating_ips[i].ip
							};	
//							console.log("floatingIpAddress=" + floatingIpParams.floatingIpAddress);
//							console.log("instanceId=" + floatingIpParams.instanceId);
							// and keep track of what IP you've selected for association. otherwise you may 
							// erroneously associate the same IP address with two differen instances
			 
							// before actually associating a floating IP, wait for some time to let the 
							// OpenStack finish spawning instance. This may take at most about 30 seconds. E.g.:
							setTimeout(function(){
								cli.associateFloatingIp(floatingIpParams, function(err, done){
									// report error or success
									if(err) return console.log("error: " + err);
								});
							}, 100000);
							// If you get the {"badRequest": {"message": "No nw_info cache associated with instance", "code": 400}}
							// error message try to increase wait time.
							break;
						}
					}
				});
			});
		});
	});
}

function loadBalancer(){
	// check if in main instance
	if(!hasAddress(mainInstanceAddr)){
		console.log("Load balancer should be run only from the main instance");
		return;
	}

	for(var i=0; i<2; i++){
		launchInstance();
	}
}

loadBalancer();		// UNCOMMENT THIS when you finished editing launchInstance()


///-------------- procesing module interface --------------///
var app = express();

app.use(express.logger());
app.use(express.json());

app.post('/api/process', function(req, res){
	var task = req.body;

	var result = processTask(task.data, task.numOfResults);
	if(result === null){
		console.log("Failed to compute results.");
		res.status(400).json({err: "Bad request"});
	}
	else{
		console.log("Successfully computed results.");
		res.status(200).json({paths: result});
	}
});

app.listen(moduleInfo.port);
console.log("Starting ACS backend module...");


///-------------- registering procesing module --------------///

function registerModule(){
	var options = {
		method: 'POST',
		hostname: '192.168.1.108',    // CHANGE THIS: internal IP address of the frontend (see slides)
		port: 3000,
		path: '/api/register',
		headers: {
			'Content-Type': 'application/json'
		}
	};
	var requestData = JSON.stringify(moduleInfo);

	///////////////////////////////////
	// - Write your request sending code and response handler function.
	// - Use the options object provided above as the options argument to Node's http.request().
	// - Use the requestData object as the request body.
	// - Check the statusCode of the response: it should be 200 if successfully registered, 400 otherwise. 
	// - Notice that response format is JSON, don't forget to run JSON.parse() on response text.
	// - Output the response result to the console. E.g.:
	//		console.log("Successfully registered backend module. Assigned ID is " + responseJSON.msg);
	//		or
	//		console.log("Failed to register backend module: " + responseJSON.err);
	// 
	// For details of how to send requests using Node's http.request, plese, refer to official Node.js documentation (http://nodejs.org/api/http.html#http_http_request_options_callback)
	//    and tutorials (http://docs.nodejitsu.com/articles/HTTP/clients/how-to-create-a-HTTP-request)
	
	// ADD YOUR CODE HERE 
	var req = http.request(options, function(res) {
		console.log('STATUS: ' + res.statusCode);
	});
	req.write(requestData);
	req.end();
	///////////////////////////////////

	console.log("Registering ACS backend module...");
}

registerModule();
