function myTrim(x) {
    return x.replace(/^\s+|\s+$/gm,'');
}

function myTrimCoordinate(x) {
	do {
		var k=x;
		x=myTrim(x);
		if (k != x) 
			continue;
		if (x.length) 
		{
			if (x[0] == ",")
				x=x.substring(1,x.length);
			else if (k[k.length-1] == ",")
				x=x.substring(0,x.length-1);
			else
				break;
			continue;
		}
		break;
	} while (true);
	return x;
}


function closestProjectionOfPointOnLine(x,y,x1,y1,x2,y2) 
{
	var status;
	var P1=null;
	var P2=null;
	var P3=null;
	var P4=null;
	var p1=[];
    var p2=[];
    var p3=[];
	var p4=[];
    var intersectionPoint=null;
    var distMinPoint=null;
    var denominator=0;
    var nominator=0;
    var u=0;
    var distOrtho=0;
    var distP1=0;
    var distP2=0;
    var distMin=0;
    var distMax=0;
   
    function intersection()
    {
        var ax = p1[0] + u * (p2[0] - p1[0]);
        var ay = p1[1] + u * (p2[1] - p1[1]);
        p4 = [ax, ay];
        intersectionPoint = [ax,ay];
    }

    function distance()
    {
        var ax = p1[0] + u * (p2[0] - p1[0]);
        var ay = p1[1] + u * (p2[1] - p1[1]);
        p4 = [ax, ay];
        distOrtho = Math.sqrt(Math.pow((p4[0] - p3[0]),2) + Math.pow((p4[1] - p3[1]),2));
        distP1    = Math.sqrt(Math.pow((p1[0] - p3[0]),2) + Math.pow((p1[1] - p3[1]),2));
        distP2    = Math.sqrt(Math.pow((p2[0] - p3[0]),2) + Math.pow((p2[1] - p3[1]),2));
        if(u>=0 && u<=1)
        {   distMin = distOrtho;
            distMinPoint = intersectionPoint;
        }
        else
        {   if(distP1 <= distP2)
            {   distMin = distP1;
                distMinPoint = P1;
            }
            else
            {   distMin = distP2;
                distMinPoint = P2;
            }
        }
        distMax = Math.max(Math.max(distOrtho, distP1), distP2);
    }
	P1 = [x1,y1];
	P2 = [x2,y2];
	P3 = [x,y];
	p1 = [x1, y1];
	p2 = [x2, y2];
	p3 = [x, y];
	denominator = Math.pow(Math.sqrt(Math.pow(p2[0]-p1[0],2) + Math.pow(p2[1]-p1[1],2)),2 );
	nominator   = (p3[0] - p1[0]) * (p2[0] - p1[0]) + (p3[1] - p1[1]) * (p2[1] - p1[1]);
	if(denominator==0)
	{   status = "coincidental"
		u = -999;
	}
	else
	{   u = nominator / denominator;
		if(u >=0 && u <= 1)
			status = "orthogonal";
		else
			status = "oblique";
	}
	intersection();
	distance();
	
	return { status : status, pos : distMinPoint, min : distMin };
}

function colorLuminance(hex, lum) {
    // Validate hex string
    hex = String(hex).replace(/[^0-9a-f]/gi, "");
    if (hex.length < 6) {
        hex = hex.replace(/(.)/g, '$1$1');
    }
    lum = lum || 0;
    // Convert to decimal and change luminosity
    var rgb = "#",
        c;
    for (var i = 0; i < 3; ++i) {
        c = parseInt(hex.substr(i * 2, 2), 16);
        c = Math.round(Math.min(Math.max(0, c + (c * lum)), 255)).toString(16);
        rgb += ("00" + c).substr(c.length);
    }
    return rgb;
}

function increaseBrightness(hex, percent) 
{
    hex = String(hex).replace(/[^0-9a-f]/gi, "");
    if (hex.length < 6) {
        hex = hex.replace(/(.)/g, '$1$1');
    }
    var rgb = "#",
        c;
    for (var i = 0; i < 3; ++i) {
        c = parseInt(hex.substr(i * 2, 2), 16);
        c = parseInt((c*(100-percent)+255*percent)/100);
        if (c > 255)
        	c=255;
        c=c.toString(16);
        console.log("C="+c);
        rgb += ("00" + c).substr(c.length);
    }
    return rgb;
}

function colorAlphaArray(hex, alpha) {
    hex = String(hex).replace(/[^0-9a-f]/gi, "");
    if (hex.length < 6) {
        hex = hex.replace(/(.)/g, '$1$1');
    }
    var res=[];
    for (var i = 0; i < 3; ++i) {
        c = parseInt(hex.substr(i * 2, 2), 16);
        res.push(c);
    }
    res.push(alpha);
    return res;
}

function escapeHTML(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
 }

function formatNumber2(val) {
	return parseFloat(Math.round(val * 100) / 100).toFixed(2);
}
function formatDate(d) {
 	var dd = d.getDate();
    var mm = d.getMonth()+1; //January is 0!
    var yyyy = d.getFullYear();
    if(dd<10){
        dd='0'+dd
    } 
    if(mm<10){
        mm='0'+mm
    } 
    return dd+'.'+mm+'.'+yyyy;
}

function formatTime(d) {
    var hh = d.getHours();
    if(hh<10){
    	hh='0'+hh
    } 
    var mm = d.getMinutes();
    if(mm<10){
        mm='0'+mm
    } 
    return hh+":"+mm;
}

function rainbow(numOfSteps, step) {
    // This function generates vibrant, "evenly spaced" colours (i.e. no clustering). This is ideal for creating easily distinguishable vibrant markers in Google Maps and other apps.
    // Adam Cole, 2011-Sept-14
    // HSV to RBG adapted from: http://mjijackson.com/2008/02/rgb-to-hsl-and-rgb-to-hsv-color-model-conversion-algorithms-in-javascript
    var r, g, b;
    var h = step / numOfSteps;
    var i = ~~(h * 6);
    var f = h * 6 - i;
    var q = 1 - f;
    switch(i % 6){
        case 0: r = 1, g = f, b = 0; break;
        case 1: r = q, g = 1, b = 0; break;
        case 2: r = 0, g = 1, b = f; break;
        case 3: r = 0, g = q, b = 1; break;
        case 4: r = f, g = 0, b = 1; break;
        case 5: r = 1, g = 0, b = q; break;
    }
    var c = "#" + ("00" + (~ ~(r * 255)).toString(16)).slice(-2) + ("00" + (~ ~(g * 255)).toString(16)).slice(-2) + ("00" + (~ ~(b * 255)).toString(16)).slice(-2);
    return (c);
}

function mobileAndTabletCheck() {
	  var check = false;
	  (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4)))check = true})(navigator.userAgent||navigator.vendor||window.opera);
	  return check;
}

var RENDEREDARROWS={};
function renderArrowBase64(width,height,color) 
{
	var key = width+"x"+height+":"+color;
	if (RENDEREDARROWS[key])
		return RENDEREDARROWS[key];
	var brdcol = "#fefefe"; //increaseBrightness(color,99);
	var svg='<svg width="'+width+'pt" height="'+height+'pt" viewBox="0 0 167 167" version="1.1" xmlns="http://www.w3.org/2000/svg">'
	+'<g><path fill="#ffffff" opacity="1.00" d=" M 0.00 0.00 L 4.54 0.00 C 2.24 0.59 0.49 2.28 0.00 4.63 L 0.00 0.00 Z" /><path fill="#ffffff" opacity="1.00" d=" M 32.36 28.90 C 67.38 45.97 102.14 63.61 137.08 80.86 C 138.64 81.62 140.17 82.45 141.69 83.30 C 105.07 101.49 68.54 119.87 32.04 138.31 C 42.56 121.80 53.53 105.56 64.23 89.16 C 65.65 86.88 68.27 84.32 66.71 81.44 C 55.37 63.86 43.61 46.54 32.36 28.90 Z" /><path fill="#ffffff" opacity="1.00" d=" M 0.00 162.56 C 0.65 164.75 2.29 166.43 4.52 167.00 L 0.00 167.00 L 0.00 162.56 Z" /></g><g><path fill="'+brdcol+'" opacity="1.00" d=" M 4.54 0.00 L 5.70 0.00 C 9.32 1.20 12.62 3.14 16.03 4.81 C 63.64 28.61 111.23 52.42 158.85 76.20 C 161.91 77.82 165.89 78.91 167.00 82.64 L 167.00 84.21 C 166.07 88.06 161.95 89.12 158.89 90.77 C 111.28 114.55 63.67 138.38 16.06 162.18 C 12.64 163.84 9.34 165.79 5.71 167.00 L 4.52 167.00 C 2.29 166.43 0.65 164.75 0.00 162.56 L 0.00 160.96 C 0.99 158.72 2.31 156.66 3.70 154.65 C 19.53 130.95 35.33 107.23 51.15 83.52 C 35.50 59.96 19.77 36.45 4.09 12.91 C 2.61 10.75 1.17 8.55 0.00 6.20 L 0.00 4.63 C 0.49 2.28 2.24 0.59 4.54 0.00 M 32.36 28.90 C 43.61 46.54 55.37 63.86 66.71 81.44 C 68.27 84.32 65.65 86.88 64.23 89.16 C 53.53 105.56 42.56 121.80 32.04 138.31 C 68.54 119.87 105.07 101.49 141.69 83.30 C 140.17 82.45 138.64 81.62 137.08 80.86 C 102.14 63.61 67.38 45.97 32.36 28.90 Z" /></g>'
	+'</svg>';
	var svg=svg.split("#ffffff").join(color);
	var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvg(canvas, svg,{ ignoreMouse: true, ignoreAnimation: true });
    return RENDEREDARROWS[key]=canvas.toDataURL();
}

var RENDEREDDIRECTIONS={};
function renderDirectionBase64(width,height,color) 
{
	var key = width+"x"+height+":"+color;
	if (RENDEREDDIRECTIONS[key])
		return RENDEREDDIRECTIONS[key];

	var svg='<svg width="'+width+'pt" height="'+height+'pt" viewBox="0 0 512 512" version="1.1" xmlns="http://www.w3.org/2000/svg">'
	+'<g id="#ffffffff">'
	+'<path fill="#ffffff" opacity="1.00" d=" M 167.56 23.47 C 181.01 9.21 200.50 1.16 220.01 0.80 C 234.04 0.78 248.07 4.76 259.98 12.21 C 275.72 21.97 287.22 38.10 291.84 56.00 C 296.56 73.49 293.73 92.27 285.99 108.46 C 324.99 108.47 363.98 108.46 402.98 108.47 C 417.88 108.69 432.70 113.53 444.81 122.22 C 459.39 132.54 469.82 148.47 473.67 165.90 C 478.22 184.82 474.33 205.45 463.82 221.74 C 451.03 241.95 427.85 255.02 403.94 255.47 C 309.29 255.46 214.64 255.47 119.99 255.47 C 101.55 254.95 84.09 246.65 70.03 235.08 C 55.75 223.40 46.11 206.24 43.81 187.92 C 40.47 164.71 49.46 140.40 66.56 124.48 C 100.25 90.83 133.91 57.15 167.56 23.47 M 208.72 46.71 C 197.04 58.04 185.71 69.71 174.21 81.22 C 170.13 84.52 167.55 89.22 163.63 92.68 C 150.10 106.13 136.56 119.56 123.24 133.23 C 120.44 135.75 117.78 138.42 115.58 141.50 C 108.21 149.14 100.70 156.65 93.10 164.06 C 87.92 168.89 85.13 176.05 85.00 183.06 C 85.70 187.91 86.61 193.02 89.72 196.98 C 95.16 204.74 104.79 208.42 113.95 209.00 C 208.96 209.01 303.97 208.98 398.98 209.01 C 406.07 208.92 413.45 206.73 418.37 201.37 C 427.64 192.56 428.37 176.57 419.75 167.08 C 415.04 161.11 407.45 158.33 400.04 158.00 C 323.34 157.98 246.63 158.04 169.92 157.97 C 183.64 144.02 197.51 130.21 211.24 116.27 C 214.95 112.33 219.30 109.00 222.39 104.49 C 229.88 96.28 238.34 88.96 245.65 80.58 C 249.49 74.25 251.33 66.20 248.68 59.07 C 245.67 47.98 234.19 40.45 222.90 41.07 C 217.90 42.00 212.57 43.14 208.72 46.71 Z" />'
	+'</g>'
	+'<g id="#000000ff">'
	+'<path fill="#000000" opacity="1.00" d=" M 208.72 46.71 C 212.57 43.14 217.90 42.00 222.90 41.07 C 234.19 40.45 245.67 47.98 248.68 59.07 C 251.33 66.20 249.49 74.25 245.65 80.58 C 238.34 88.96 229.88 96.28 222.39 104.49 C 219.30 109.00 214.95 112.33 211.24 116.27 C 197.51 130.21 183.64 144.02 169.92 157.97 C 246.63 158.04 323.34 157.98 400.04 158.00 C 407.45 158.33 415.04 161.11 419.75 167.08 C 428.37 176.57 427.64 192.56 418.37 201.37 C 413.45 206.73 406.07 208.92 398.98 209.01 C 303.97 208.98 208.96 209.01 113.95 209.00 C 104.79 208.42 95.16 204.74 89.72 196.98 C 86.61 193.02 85.70 187.91 85.00 183.06 C 85.13 176.05 87.92 168.89 93.10 164.06 C 100.70 156.65 108.21 149.14 115.58 141.50 C 117.78 138.42 120.44 135.75 123.24 133.23 C 136.56 119.56 150.10 106.13 163.63 92.68 C 167.55 89.22 170.13 84.52 174.21 81.22 C 185.71 69.71 197.04 58.04 208.72 46.71 Z" />'
	+'</g>'
	+'</svg>';

	var svg=svg.split("#000000").join(color);
	var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvg(canvas, svg,{ ignoreMouse: true, ignoreAnimation: true });
    return RENDEREDDIRECTIONS[key]=canvas.toDataURL();
}

var RENDEREBOXES={};
function renderBoxBase64(width,height,color) 
{
	var key = width+"x"+height+":"+color;
	if (RENDEREBOXES[key])
		return RENDEREBOXES[key];

	var svg='<svg width="'+width+'pt" height="'+height+'pt" viewBox="0 0 512 512" version="1.1" xmlns="http://www.w3.org/2000/svg">'
	+'<g id="#ffffffff">'
	+'<path fill="#ffffff" opacity="1.00" d=" M 55.50 0.00 L 458.45 0.00 C 472.44 0.99 486.03 7.09 495.78 17.23 C 505.34 26.88 511.01 40.04 512.00 53.55 L 512.00 458.44 C 510.99 472.43 504.90 486.01 494.77 495.77 C 485.11 505.32 471.96 511.01 458.45 512.00 L 53.56 512.00 C 39.57 510.99 25.97 504.91 16.22 494.78 C 6.67 485.12 0.97 471.97 0.00 458.45 L 0.00 55.50 C 0.40 41.07 6.45 26.89 16.74 16.73 C 26.89 6.45 41.07 0.41 55.50 0.00 M 56.90 56.90 C 56.87 189.63 56.86 322.36 56.90 455.09 C 189.63 455.12 322.36 455.12 455.09 455.09 C 455.12 322.36 455.12 189.63 455.09 56.90 C 322.36 56.86 189.63 56.87 56.90 56.90 Z" />'
	+'</g>'
	+'<g id="#000000ff">'
	+'<path fill="#000000" opacity="1.00" d=" M 56.90 56.90 C 189.63 56.87 322.36 56.86 455.09 56.90 C 455.12 189.63 455.12 322.36 455.09 455.09 C 322.36 455.12 189.63 455.12 56.90 455.09 C 56.86 322.36 56.87 189.63 56.90 56.90 Z" />'
	+'</g>'
	+'</svg>';

	var svg=svg.split("#000000").join(color);
	var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvg(canvas, svg,{ ignoreMouse: true, ignoreAnimation: true });
    return RENDEREBOXES[key]=canvas.toDataURL();
}

window.MOBILE=mobileAndTabletCheck();
window.WGS84SPHERE = new ol.Sphere(6378137);

