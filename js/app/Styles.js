window.STYLES={

	// style function for track
	//------------------------------------------------
	"track" : function(feature,resolution) 
	{
		var styles=
		[
			// DEFAULT STYLE
			new ol.style.Style({
			  stroke: new ol.style.Stroke({
				color: '#9bff80',
				width: 4
			  })
			})
		];
		var coords = feature.getGeometry().getCoordinates(); 
		if (coords && coords.length >= 2) 
		{
			var end = coords[coords.length-1];
			var start = coords[coords.length-2];
			var dx = end[0] - start[0];
			var dy = end[1] - start[1];
			var rotation = Math.atan2(dy, dx);
			styles.push(new ol.style.Style(
			{
			  geometry: new ol.geom.Point(end),
			  image: new ol.style.Icon({
				src: 'img/arrow.png',
				anchor: [1, 0.5],
				rotateWithView: false,
				rotation: -rotation
			  })
			}));
		}
		return styles;
	},
	//--------------------------------------
	"debugGPS" : function(feature,resolution) 
	{
		var coef = ((new Date()).getTime()-feature.timeCreated)/(CONFIG.timeouts.gpsLocationDebugShow*1000);
		if (coef > 1)
			coef=1;

		return [
		        new ol.style.Style({
		        image: new ol.style.Circle({
		            radius: coef*20,
		            stroke: new ol.style.Stroke({
		            	//feature.color
		                color: colorAlphaArray(feature.color,(1.0-coef)*1.0), 
		                width: 4
		            })
		          })
		})];
	},
	
	"participant" : function(feature,resolution) 
	{
		var etxt="";
		var part = feature.participant;
		var lstate = null;
		if (part.states.length) {
			lstate = part.states[part.states.length-1];
			etxt=" "+parseFloat(Math.ceil(lstate.getSpeed() * 100) / 100).toFixed(2)+" m/s";// | acc "+parseFloat(Math.ceil(lstate.getAcceleration() * 100) / 100).toFixed(2)+" m/s";
		}
		var zIndex = Math.floor(feature.participant.getElapsed()*1000);
		var styles=
		[
			new ol.style.Style({
					zIndex: zIndex,
					image: new ol.style.Icon(({
					  anchor: [0.5, 1],
					  anchorXUnits: 'fraction',
					  anchorYUnits: 'fraction',
					  opacity: 1,
					  src : 
						feature.participant.isSOS ? 'img/warning-red.png' : 
						feature.participant.isDiscarded ? 'img/warning-yellow.png' : 
						feature.participant.icon, 
					  scale : 0.3
					  //size : [22,16]
				   })),
				   text: new ol.style.Text({
						font: 'bold 13px Arial,Lucida Grande,Tahoma,Verdana',
						fill: new ol.style.Fill({
						  color: feature.participant.color
						}),
						stroke: new ol.style.Stroke({
						  color: [0, 0, 0, 0.5],
						  width: 4
						}),
						text : feature.participant.getCode(),
						offsetX : 0,
						offsetY : 5
					  })
				   })
				   
		];
		if (lstate && lstate.getSpeed() > 0 && !feature.participant.isSOS && !feature.participant.isDiscarded) 
			styles.push(new ol.style.Style({
				   zIndex: zIndex,
				   text: new ol.style.Text({
						font: 'bold 10px Arial,Lucida Grande,Tahoma,Verdana',
						fill: new ol.style.Fill({
						  color: feature.participant.color
						}),
						stroke: new ol.style.Stroke({
						  color: [0, 0, 0, 0.5],
						  width: 2
						}),
						text : etxt,
						offsetX : 0,
						offsetY : 17
					  })
				   }));
		
		return styles;
	},
	//------------------------------------------------
	"trackselected" : new ol.style.Style(
	{
		stroke: new ol.style.Stroke({
			color: '#FF5050',
			width: 4.5
		})
	})
};