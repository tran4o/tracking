//--------------------------------------------------------------------
var CONFIG = require('./../app/Config');
var Utils = require('./../app/Utils');
var Config = require('./Config');
var Tracking = require('./Tracking');
var WGS84SPHERE = Utils.WGS84SPHERE;
var moment = require('moment');
var http = require('http');
var requestJSON = require('request-json');
var request = require('request');
//--------------------------------------------------------------------
function generateJSON(imei,lons,lats,times)
{
	var res = {  
	   "TYPE":"RACEDATA",
	   "VER":"1.0",
	   "IMEI":imei,
	   "RACEREC":[  
	      {  
	         "LAT":""+Math.round(lats[0]*1000000),
	         "LON":""+Math.round(lons[0]*1000000),
	         "ALT":"0",
	         "HRT":"0",
	         "DATE": moment.utc(times[0]).format("YYYY-MM-DD"),
	         "TIME": moment.utc(times[0]).format("HHmmss.SS")
	      },
	      {  
		     "LAT":""+Math.round(lats[1]*1000000),
		     "LON":""+Math.round(lons[1]*1000000),
		     "ALT":"0",
		     "HRT":"0",
		     "DATE": moment.utc(times[1]).format("YYYY-MM-DD"),
		     "TIME": moment.utc(times[1]).format("HHmmss.SS")
	      },
	      {  
			 "LAT":""+Math.round(lats[2]*1000000),
			 "LON":""+Math.round(lons[2]*1000000),
			 "ALT":"0",
			 "HRT":"0",
			 "DATE": moment.utc(times[2]).format("YYYY-MM-DD"),
			 "TIME": moment.utc(times[2]).format("HHmmss.SS")
	      }
	   ]
	};
	return res;
}
//------------------------------------------
exports.startSimulation = function(track,coef)  
{
	var trackInSeconds = 5*60*coef;	//10 min
	console.log("Staring simulation with coef "+coef);
	var stime = (new Date()).getTime();			 	// start ofs -30 sec 			
	var randcoef = CONFIG.simulation.gpsInaccuracy * track.getTrackLengthInWGS84() / track.getTrackLength();
	// clear all gps tracking data first..
	var k=0;
	for (var i in track.participants) 
	{
		var id = track.participants[i].deviceId;
		k++;
		request.get("http://liveortung.de/triathlon/rest/clearRace/"+id,doIt);
	}
	
	function doIt() {
		k--;
		if (k == 0) {
			console.log("Clearing data for simulation DONE | Starting... ")
			tick();
			setInterval(tick,30*1000); /* 30 seconds every simulation */
		}
	}

	track.test1();
	
	var cc=1;
	function tick() 
	{
		var ctime = (new Date()).getTime();
		for (var i in track.participants) 
		{
			var part = track.participants[i];		
			var lons = [];
			var lats = [];
			var times = [];
			var occ=cc;
			for (var k=0;k<3;k++) 
			{
				var tm = ctime - (2-k)*10*1000;
				if (tm < stime)
					tm=stime;
				var elapsed = occ/60.0;
				var elapsed = ((tm - stime)/1000.0)/trackInSeconds + Config.simulation.startElapsed;
				if (elapsed > 1)
					elapsed=1;
				occ++;
				var pos = track.getPositionAndRotationFromElapsed(elapsed);
				var dist1 = (Math.random()*2.0-1.0) * randcoef;
				var dist2 =  (Math.random()*2.0-1.0)  * randcoef;
				//pos[0]+=dist1;
				//pos[1]+=dist2;
				times.push(tm); // GMT timestamp
				lons.push(pos[0]);
				lats.push(pos[1]);
			}
			var json = generateJSON(part.deviceId,lons,lats,times);
			var client = requestJSON.createClient("http://liveortung.de");
			function onReqDone() {
				//return console.log("POSTED for "+this.deviceId+" | TIME = "+moment.utc(times[0]).format("HHmmss.SS")+" | "+JSON.stringify(json));								
			}
			client.post('http://liveortung.de/triathlon/rest/raceData/blah/'+part.deviceId, json, onReqDone.bind(part));
		}
		cc+=3;
	}	
}
