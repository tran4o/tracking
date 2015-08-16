var moment = require('moment');
var fs = require('fs');
var path = require('path');
var xml2js = require('xml2js');
var Utils = require("./../app/Utils");
//var low = require('lowdb');
//--------------------------------------------------------------------------------------
console.log("Loading server configuration...");
var data = fs.readFileSync(path.join(__dirname, "../../data/config.json"),{ encoding: 'utf8' });
console.log("Config data length "+data.length+" bytes");
var json=JSON.parse(data);
var now = (new Date()).getTime();
json.event.startTime = json.simulation.enabled ? new Date() : new Date(moment(json.event.startTime, "DD.MM.YYYY HH:mm"));
json.event.endTime = json.simulation.enabled ? new Date((new Date().getTime())+60*1000*60*24) : new Date(moment(json.event.endTime, "DD.MM.YYYY HH:mm"));
console.log("\nEvent configration ["+Utils.formatDateTime(json.event.startTime)+"  >  "+Utils.formatDateTime(json.event.endTime)+"]");
console.log("Now is "+Utils.formatDateTime(new Date(now)));
console.log((json.event.startTime.getTime()-now)/(60.0*1000.0)+" MINUTES TO GO\n");
for (var i in json.starts) 
{
	var str = json.starts[i];
	str.start = json.simulation.enabled ?  new Date() : new Date(moment(str.startTime, "DD.MM.YYYY HH:mm"));
	//console.log("#START for ["+str.fromStartNo+".."+str.toStartNo+"] @ "+Utils.formatDateTime(str.start));
}
for (var i in json)
	exports[i]=json[i];
var startTimes =  json.starts;
exports.getStartTimeFromStartPos = function(startPos) 
{
	for (var i in startTimes) 
	{
		if (startPos >= startTimes[i].fromStartNo && startPos <= startTimes[i].toStartNo) {
			return startTimes[i].start.getTime();
		}
	}
	return 0;
}
//--------------------------------------------------------------------------------------
console.log("\nLoading participants list...");
var data = fs.readFileSync(path.join(__dirname, "../../data/participants.json"),{ encoding: 'utf8' });
console.log("Participants data length "+data.length+" bytes");
var json=JSON.parse(data);
var now = (new Date()).getTime();
exports.participants=json.participations;
console.log(json.participations.length+" participants total loaded\n");
//--------------------------------------------------------------------------------------
var data = fs.readFileSync(path.join(__dirname, "../../data/aliases.xml"),{ encoding: 'utf8' });
var aliases={};
xml2js.parseString(data, function (err, result) {
	if (err)
		console.log("ERROR parsing aliases.xml");
	else {
		var devs = result["entity-engine-xml"]["M2MDevice"];
		for (var i in devs) 
		{
			var dev = devs[i]["$"];
			aliases[dev.m2mDeviceId]=dev.imeiNumber;
		}
	}
});
//--------------------------------------------------------------------------------------
var apath = path.join(__dirname, "../../data/assignments.json");
var data = "{}";
if (fs.existsSync(apath))
	data=fs.readFileSync(apath,{ encoding: 'utf8' });
console.log("Assignments data length "+data.length+" bytes");
var assignments={};
try {
	assignments=JSON.parse(data);
} catch(e) {
	console.log("ERROR parsing json (assignments) : "+e)
}
exports.assignments=assignments;
function mapIMEI(imei) {
	if (aliases[imei])
		return aliases[imei];
	return imei;
}

function unmapIMEI(imei) 
{	
	for (var i in aliases) {
		if (aliases[i] == imei)
			return i;
	}
	return imei;
}

exports.aliases=aliases;
exports.mapIMEI=mapIMEI;
exports.unmapIMEI=unmapIMEI;
function assignIMEI(mikaId,imei) 
{
	if (!imei)
		delete assignments[mikaId];
	else
		assignments[mikaId]=imei;
	fs.writeFileSync(apath, JSON.stringify(assignments, null, 4)); 
}
function lookupIMEI(id) {
	if (assignments[id] && assignments[id].length)
		return assignments[id]; 
	return null;
}
exports.assignIMEI=assignIMEI;
//-----------------------------------
function updateParticipant(id,json) 
{
	for (var i in exports.participants) 
	{
		var part = exports.participants[i];
		if (part.idParticipant == id) {
			// UNMAP TO BE DONE!
			part.deviceId=id;
			part.firstname=json.firstname;
			part.lastname=json.lastname;
			if (json.birthDate)
				part.birthDate=json.birthDate;
			else
				delete part.birthDate;
			part.nationality=json.nationality;
			part.club=json.club;
			part.sex=json.gender;
			part.startGroup=json.startGroup;
			if (json.startNo == undefined)
				delete part.startNo;
			else
				part.startNo=json.startNo;
			return part;
		}
	}
	return "Participant not found";
}
exports.updateParticipant=updateParticipant;
//-----------------------------------
//assignIMEI("ABC1","123A");
//--------------------------------------------------------------------------------------
console.log("Found "+Object.keys(assignments).length+" assignments\n");
console.log(Object.keys(aliases).length+" aliases read from aliases.xml");
