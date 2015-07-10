//--------------------------------------------------------------------
var CONFIG = require('./../app/Config');
var Utils = require('./../app/Utils');
var Config = require('./Config');
var Tracking = require('./Tracking');
var WGS84SPHERE = Utils.WGS84SPHERE;
var moment = require('moment');
var http = require('http');
var request = require('request-json');

//--------------------------------------------------------------------
function generateJSON(imei,lons,lats,times)
{
	var res = {  
	   "TYPE":"RACEDATA",
	   "VER":"1.0",
	   "IMEI":imei,
	   "RACEREC":[  
	      {  
	         "LAT":""+parseInt(Math.round(lats[0]*1000000)),
	         "LON":""+parseInt(Math.round(lons[0]*1000000)),
	         "ALT":"0",
	         "HRT":"0",
	         "SOS":"0",
	         "DATE": moment(times[0]).format("YYYY-MM-DD"),
	         "TIME": moment(times[0]).format("HHmmss.SSS")
	      },
	      {  
		     "LAT":""+parseInt(Math.round(lats[1]*1000000)),
		     "LON":""+parseInt(Math.round(lons[1]*1000000)),
		     "ALT":"0",
		     "HRT":"0",
	         "SOS":"0",
		     "DATE": moment(times[1]).format("YYYY-MM-DD"),
		     "TIME": moment(times[1]).format("HHmmss.SSS")
	      },
	      {  
			 "LAT":""+parseInt(Math.round(lats[2]*1000000)),
			 "LON":""+parseInt(Math.round(lons[2]*1000000)),
			 "ALT":"0",
			 "HRT":"0",
	         "SOS":"0",
			 "DATE": moment(times[2]).format("YYYY-MM-DD"),
			 "TIME": moment(times[2]).format("HHmmss.SSS")
	      }
	   ]
	};
	return res;
}
//------------------------------------------
exports.startSimulation = function(track,coef)  
{
	var trackInSeconds = 10*60;	//10 min
	console.log("Staring simulation with coef "+coef);
	var delay = -(new Date()).getTimezoneOffset()*60*1000;	// 120 for gmt+2
	var stime = (new Date()).getTime();			 	// start ofs -30 sec 			
	var coef = track.getTrackLength() / track.getTrackLengthInWGS84();  
	var p0 = track.route[0];
	var randcoef = CONFIG.simulation.gpsInaccuracy * 0.0001 / WGS84SPHERE.haversineDistance(p0, [p0[0]+0.0001, p0[1]+0.0001]);		
	setInterval(function(e) 
	{
		var ctime = (new Date()).getTime();
		for (var i in track.participants) 
		{
			var part = track.participants[i];		
			var lons = [];
			var lats = [];
			var times = [];
			for (var k=0;k<3;k++) 
			{
				var tm = ctime - (2-k)*10*1000;
				if (tm < stime)
					tm=stime;
				var elapsed = ((tm - stime)/1000.0)/trackInSeconds; 
				var pos = track.getPositionFromElapsed(elapsed % 1.0);
				var dist1 = (Math.random()*2.0-1.0) * randcoef;
				var dist2 =  (Math.random()*2.0-1.0)  * randcoef;
				pos[0]+=dist1;
				pos[1]+=dist2;
				times.push(tm-delay); // GMT timestamp
				lons.push(pos[0]);
				lats.push(pos[1]);
			}
			//var url = "http://liverank-portal.de/triathlon/rest/raceData/blah/"+part.deviceId;		
			var json = generateJSON(part.deviceId,lons,lats,times);
			var client = request.createClient("http://liverank-portal.de");
			console.log("DOING "+'http://liverank-portal.de/triathlon/rest/raceData/blah/'+part.deviceId);
			function onReqDone(err, res, body) {
				return console.log("POSTED for "+this.deviceId+" | "+res.statusCode);								
			}
			client.post('http://liverank-portal.de/triathlon/rest/raceData/blah/'+part.deviceId, json, onReqDone.bind(part));
			//break;
		}
	},30*1000); /* 30 seconds every simulation */
}
