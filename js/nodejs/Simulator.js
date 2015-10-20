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
var coefy = CONFIG.math.projectionScaleY;
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
exports.simulate = function(event,track,onDone)  
{
	if (!track.participants || !track.participants.length) {
		onDone();
		return;
	}
	//-------------------------------
	// clear all gps tracking data first..
	var cnt1=0;
	for (var i in track.participants) 
	{
		var id = track.participants[i].deviceId;
		cnt1++;
		request.get("http://liveortung.de/triathlon/rest/clearRace/"+id,doIt);
	}
	
	function doIt() 
	{
		cnt1--;
		if (cnt1 == 0) 
		{
			var randcoef = CONFIG.simulation.gpsInaccuracy * track.getTrackLengthInWGS84() / track.getTrackLength();
			var stime = event.startTime.getTime();
			var etime = event.endTime.getTime();
			console.log("Done clearing log! Starting simulation "+event.code);
			console.log(event.startTime);
			console.log(event.endTime);
			var coefs=[];
			for (var i in track.participants) 
				coefs.push(Math.random()+1);
			var t=stime-30*1000; 
		    function doOne()
			{
		    	t+=30*1000;
		    	if (t >= event.endTime.getTime()) {
		    		onDone();
		    		return;
		    	}
				var kk=track.participants.length;
				console.log("Simulate "+new Date(t));
				for (var i in track.participants) 
				{
					var part = track.participants[i];		
					var lons = [];
					var lats = [];
					var times = [];
					for (var k=0;k<3;k++) 
					{
						var tm = t + k*10*1000;
						var elapsed = (tm - stime)/(etime-stime)*coefs[i];
						if (elapsed > 1)
							elapsed=1;
						var pos = track.getPositionAndRotationFromElapsed(elapsed);
						var dist1 = (Math.random()*2.0-1.0)*randcoef;
						var dist2 =  (Math.random()*2.0-1.0)*randcoef*coefy;
						pos[0]+=dist1;
						pos[1]+=dist2;
						times.push(tm); // GMT timestamp
						lons.push(pos[0]);
						lats.push(pos[1]);
						console.log("ELAPSED="+elapsed);
					}
					var json = generateJSON(part.deviceId,lons,lats,times);
					var client = requestJSON.createClient("http://liveortung.de");
					function onReqDone() {
						kk--;
						//console.log(kk+" | POSTED for "+this.deviceId+" | TIME = "+moment.utc(times[0]).format("HHmmss.SS")+" | "+JSON.stringify(json));
						if (kk == 0) {
							doOne();
						}
					}
					client.post('http://liveortung.de/triathlon/rest/raceData/blah/'+part.deviceId, json, onReqDone.bind(part));
				}
			}
		    doOne();
		}
	}
	//-------------------------------
	
}
