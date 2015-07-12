require('./../app/Track');
require('./StreamData');
var requestJSON = require('request-json');
var BinarySearchTree = require('binary-search-tree').BinarySearchTree;
var Utils = require('./../app/Utils');
var CONFIG = require('./../app/Config');
var Config = require('./Config');
var Simulator = require('./Simulator');
var request = require('request-json');
var fs = require('fs');
var path = require('path');
//------------------------------------------------------------------
var TRACK = new Track();
TRACK.setBikeStartKM(Config.event.bikeStartKM);
TRACK.setRunStartKM(Config.event.runStartKM);
TRACK.setRoute(Config.event.trackData);
TRACK.init();
console.log("Starting tracking engine for track with length "+Utils.formatNumber2(TRACK.getTrackLength()/1000.0)+" km. ("+Utils.formatNumber2(Config.event.bikeStartKM)+" + "+Utils.formatNumber2(Config.event.runStartKM-Config.event.bikeStartKM)+" + "+Utils.formatNumber2(TRACK.getTrackLength()/1000.0-Config.event.runStartKM)+") km");
//------------------------------------------------------------------
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
		part.setColor(Utils.rainbow(Object.keys(Config.assignments).length,trackedParticipants.length));
		part.setAgeGroup(p.ageGroup);
		part.setAge(2015-parseInt(p.birthYear));	/* TODO!!! */
		part.setCountry(p.nationality);
		part.setStartPos(parseInt(p.startNo));
		part.setGender(p.sex);

		var apath = path.join(__dirname, "../../img/data/"+id+".jpg");
		if (fs.existsSync(apath)) {
			part.setIcon("img/data/"+id+".jpg");
			part.setImage("img/data/"+id+".jpg");
		} else {
			part.setIcon("img/noimage.png");
			part.setImage("img/noimage.png");			
		}
		trackedParticipants.push(part);
		partLookupByIMEI[devId]=part;
		//-----------------------------
		part.setStartTime(Config.getStartTimeFromStartPos(part.getStartPos()));
		if (Config.simulation.singleParticipant)
			break;
	} 
}
if (!Config.simulation.singleParticipant)
for (var i in Config.cams) 
{
	var cam = Config.cams[i];
	var part = TRACK.newParticipant(cam.code,cam.deviceId,cam.name);
	part.setAgeGroup("-");
	part.setGender("-");
	part.setCountry("Germany");
	part.setIcon(cam.icon);
	part.setImage(cam.icon);
	part.setStartPos(0);
	part.setAge(0);
	trackedParticipants.push(part);
	partLookupByIMEI[devId]=part;
	part.setStartTime(1); /* placeholder not 0 */
	part.__cam=1;
}
console.log(trackedParticipants.length+" tracked participants found");
//--------------------------------------------------------------------------

//--------------------------------------------------------------------------
var delay = -(new Date()).getTimezoneOffset()*60*1000;	// 120 for gmt+2
var startTime = (new Date()).getTime() - 10*60*1000;	// 10 minutes before
function inRaceChecker() {
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
// COPY... 
CONFIG.math.displayDelay = Config.interpolation.displayDelay;
//--------------------------------------------------------------------------
// EVERY 5 seconds interpolation and ranking calculations
//--------------------------------------------------------------------------
var stateStorage = {}; 
function addState(imei,state) 
{
	if (!stateStorage[imei])
		stateStorage[imei]=new BinarySearchTree();
	stateStorage[imei].insert(state.getTimestamp(),state);	
	if (stateStorage[imei].data.length > 3000)
		stateStorage[imei].delete(stateStorage[imei].getMinKey());
}
//--------------------------------------------------------------------------
setInterval(function() 
{
	if (!inRaceChecker())
		return;	
	var ctime = (new Date()).getTime() - Config.interpolation.displayDelay*1000;
	var overAllRank={};
	var genderRank={};
	var groupRank={};
	var arr=[];
	var val=[];
	var elapsed=[];
	for (var i in trackedParticipants) 
	{ 
		var part = trackedParticipants[i];
		var elp = part.avg(ctime,"elapsed")
		if (elp == null)
			continue;
		arr.push(i);
		elapsed.push(elp);
		var spd = part.avg(ctime,"speed");
		if (spd == 0)
			val.push(999999999.0);
		else {
			var moredist = (1.0-elp)*TRACK.getTrackLength();
			val.push(moredist/spd);
		}
	}
	console.log(arr.length+" | GENERATE INTERMIDIATE : "+Utils.formatDateTimeSec(new Date(ctime)));
	//console.log(val);
	arr.sort(function(a, b){
		return val[a]-val[b];
	});
	var tmp={};
	var tmp1={};
	var k=0;
	for (var i in arr) 
	{
		var part = trackedParticipants[arr[i]];
		var ageGroup = part.getAgeGroup();
		var gender = part.getGender();
		if (!tmp[ageGroup])
			tmp[ageGroup]=[];
		tmp[ageGroup].push(part);
		if (!tmp1[gender])
			tmp1[gender]=[];
		tmp1[gender].push(part);
		overAllRank[part.deviceId]=k+1;
		groupRank[part.deviceId]=tmp[ageGroup].length;
		genderRank[part.deviceId]=tmp1[gender].length;
		k++;
	}
	for (var i in arr) 
	{
		var part = trackedParticipants[arr[i]];		
		var ts = new ParticipantState();
		ts.setSpeed(part.avg(ctime,"speed"));
		ts.setElapsed(elapsed[i]);
		ts.setFreq(parseInt(part.avg(ctime,"freq")));
		ts.setAcceleration(part.avg(ctime,"acceleration"));
		ts.setAlt(parseInt(part.avg(ctime,"alt")));
		ts.setGps(part.avg2(ctime,"gps"));
		ts.setIsSOS(part.states[part.states.length-1].getIsSOS());
		ts.setTimestamp(ctime);		
		ts.setOverallRank(overAllRank[part.deviceId]);
		ts.setGenderRank(genderRank[part.deviceId]);
		ts.setGroupRank(groupRank[part.deviceId]);		
		//console.log(ts);
		addState(part.deviceId,ts);
	}
},5000);
//--------------------------------------------------------------------------
// from inclusive , to exclusive
exports.queryData = function(imei,from,to) 
{
	if (!inRaceChecker())
		return [];
	var res=[];
	if (stateStorage[imei]) 
	{
		var qry = stateStorage[imei].betweenBounds({ $gte: from, $lt: to });
		for (var j in qry) 
		{
			var state = qry[j];
			res.push({
				imei : imei,
				speed : state.speed,
				elapsed : state.elapsed,
				timestamp : state.timestamp-delay,		// UTC
				gps : state.gps,
				freq : state.freq,
				isSOS : state.isSOS,
				acceleration : state.acceleration,
				alt : state.alt,
				overallRank : state.overallRank,
				genderRank : state.genderRank,
				groupRank : state.groupRank
			});
		}
	}
	return res;
}
//--------------------------------------------------------------------------
function doHTTP(url,json,onReqDone) 
{
    if (json.length) 
    {
		var client = requestJSON.createClient("http://liverank-portal.de");
		function postDone(err, res, body) 
		{
			if (err)
				console.log("Error geting server live data "+err);
			else
				onReqDone(body);
		}
		client.post(url, json, postDone);
    }                		
}
var stream = new StreamData();
stream.start(TRACK,inRaceChecker,Config.network.pingInterval,doHTTP);
