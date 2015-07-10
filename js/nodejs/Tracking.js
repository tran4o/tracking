require('./../app/Track');
var Utils = require('./../app/Utils');
var Config = require('./Config');
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
		trackedParticipants.push(part);
		/*console.log(p);
		console.log(part.ageGroup);
		console.log(part.age);
		console.log(part.country);		
		console.log(part.color);		
		console.log("\n\n");*/
	} 
}

console.log(trackedParticipants.length+" tracked participants found");