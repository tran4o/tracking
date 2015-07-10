require('./../app/Track');
var Utils = require('./../app/Utils');
var Config = require('./Config');
var Simulator = require('./Simulator');
var request = require('request-json');
//------------------------------------------------------------------
var TRACK;

TRACK = new Track();
TRACK.setBikeStartKM(Config.event.bikeStartKM);
TRACK.setRunStartKM(Config.event.runStartKM);
TRACK.setRoute(Config.event.trackData);
console.log("Starting tracking engine for track with length "+Utils.formatNumber2(TRACK.getTrackLength()/1000.0)+" km. ("+Utils.formatNumber2(Config.event.bikeStartKM)+" + "+Utils.formatNumber2(Config.event.runStartKM-Config.event.bikeStartKM)+" + "+Utils.formatNumber2(TRACK.getTrackLength()/1000.0-Config.event.runStartKM)+") km");

function getAge(birthDate) {
    var today = new Date();
    var age = today.getFullYear() - birthDate.getFullYear();
    var m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

var trackedParticipants=[];
var partLookupByIMEI={};
for (var i in Config.participants) 
{
	var p = Config.participants[i];
	var id = p.idParticipant;
	if (Config.assignments[id] && Config.assignments[id].length) 
	{
		var devId = Config.assignments[id];
		var part = TRACK.newParticipant(id,devId,p.firstname+" "+p.lastname);
		part.setColor(Utils.rainbow(Config.assignments.length,trackedParticipants.length));
		part.setAgeGroup(p.ageGroup);
		part.setAge(getAge(new Date(p.birthDate)));
		part.setCountry(p.nationality);
		//part.setIcon(images[i]);
		//part.setImage(images[i]);
		trackedParticipants.push(part);
		partLookupByIMEI[devId]=part;
	} 
}
console.log(trackedParticipants.length+" tracked participants found");
//--------------------------------------------------------------------------
var delay = -(new Date()).getTimezoneOffset()*60*1000;	// 120 for gmt+2
var startTime = (new Date()).getTime() - 10*60*1000;	// 10 minutes before
// every 4 sec.
setInterval(function(e) 
{
	var ctime = (new Date()).getTime();
	var isTime = (ctime >= Config.event.startTime.getTime() && ctime <= Config.event.endTime.getTime());
	if (!isTime) 
		return;
	function onData(data) 
	{
		if (!data || !data.length)
			return;
		for (var i=0;i<data.length;i++) 
		{
			var e = data[i];		
			//----------------------------------
			delete e._id;
			delete e.TS;		
			e.LON=parseInt(e.LON);
			e.LAT=parseInt(e.LAT);
			if (isNaN(e.LON) || isNaN(e.LAT))
				continue;
			if (e.ALT)
				e.ALT=parseFloat(e.ALT);
			if (e.TIME)
				e.TIME=parseFloat(e.TIME);		
			if (e.HRT)
				e.HRT=parseInt(e.HRT);
			//----------------------------------
			var c = [e.LON / 1000000.0,e.LAT / 1000000.0];
			var actime = parseInt(e.EPOCH);
			if (!actime)
				continue;
			var part = partLookupByIMEI[e.IMEI];
			if (!part) {
				console.log("FUCK PART "+e.IMEI);
				continue;
			}
			actime+=delay;
			console.log("PING "+part.code+" | "+part.deviceId+" | "+Utils.formatDateTimeSec(new Date(actime))+" | "+c[0]+" "+c[1]+" | DELAY = "+((new Date()).getTime()-actime)/1000.0+" sec delay") ;
			part.ping(c,e.HRT,false/*sos */,actime,e.ALT,0/* overall rank*/,0/*groupRank*/,0/*genderRank*/);
		}
	}
	//-------------------------------------------------------------------------------------------------------------------------------------
	var arr=[];
	function check(force) 
	{
		if (arr.length >= 80 || (arr.length && force)) 
		{			
			//console.log("GETTING : "+url);			
			//var st=(new Date()).getTime();
			var url = "http://liverank-portal.de/triathlon/rest/raceRecord/"+arr.join(",")+"?from="+(startTime-delay)+"&to="+(ctime-delay);
			arr=[];
			var client=request.createClient("http://liverank-portal.de");
			client.get(url, function(err, res, body) 
			{
				onData(body);
				//var dur=(new Date()).getTime();
				//dur-=st;
				//console.log("FINISH : "+dur/1000.0+" sec.");
				/*console.log("ERR : "+err);
				console.log("BODY : ");
				console.log(body);*/
			});
		}
	}
	for (var i in trackedParticipants) 
	{
		var part = trackedParticipants[i];
		arr.push(part.deviceId);
		check()
	}
	check(true);
	startTime=ctime;
},4000);
//--------------------------------------------------------------------------
if (Config.simulation.enabled) 
	Simulator.startSimulation(TRACK,Config.simulation.speedCoef);	


//--------------------------------------------------------------------------
exports.trackedParticipants=trackedParticipants;