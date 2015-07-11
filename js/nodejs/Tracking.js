require('./../app/Track');
require('./../app/StreamData');
var Utils = require('./../app/Utils');
var CONFIG = require('./../app/Config');
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
		part.setStartPos(parseInt(p.startNo));		
		part.setIcon("data/img/"+devId+".jpg");
		part.setImage("data/img/"+devId+".jpg");
		trackedParticipants.push(part);
		partLookupByIMEI[devId]=part;
		//-----------------------------
		part.setStartTime(Config.getStartTimeFromStartPos(part.getStartPos()));
		//console.log("PART "+part.getCode()+" NO:"+part.getStartPos()+" | "+Utils.formatDateTimeSec(new Date(part.startTime)))
	} 
}
console.log(trackedParticipants.length+" tracked participants found");
//--------------------------------------------------------------------------
var delay = -(new Date()).getTimezoneOffset()*60*1000;	// 120 for gmt+2
var startTime = (new Date()).getTime() - 10*60*1000;	// 10 minutes before
function isInRaceChecker() {
	var ctime = (new Date()).getTime();
	var isTime = (ctime >= Config.event.startTime.getTime() && ctime <= Config.event.endTime.getTime());
	return isTime;
}
//--------------------------------------------------------------------------
if (Config.simulation.enabled) 
	Simulator.startSimulation(TRACK,Config.simulation.speedCoef);	
//--------------------------------------------------------------------------
exports.trackedParticipants=trackedParticipants;
exports.partLookupByIMEI=partLookupByIMEI;
//--------------------------------------------------------------------------
CONFIG.math.displayDelay = Config.interpolation;
var stream = new StreamData();
stream.start(TRACK,inRaceChecker);
//--------------------------------------------------------------------------
// EVERY 5 seconds interpolation and ranking calculations
//--------------------------------------------------------------------------
setInterval(function() 
{
	if (!inRaceChecker())
		return;	
	var ctime = (new Date()).getTime();
	for (var i in trackedParticipants) 
	{
		var part = trackedParticipants[i];
		part.calculateElapsedAverage(ctime);
	}
},5000);



