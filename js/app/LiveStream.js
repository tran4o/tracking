Class("LiveStream", {
    has : {
        _$comp : {
            init: function(config) {
                return $('#' + config.id);
            }
        },

        _isShown : {
           init : false
        },

        _isValid : {
            init : false
        }
    },
    methods: {
        initialize: function() {
            var liveStreams = LIVE_STREAMS;
            if (!liveStreams || liveStreams.length <= 0) {
                console.warn("No live streams set");
                return;
            }

            // initialize the streams
            var self = this;
            var i = 0;
            this._$comp.find(".liveStreamThumb").addClass("inactive").each(function() {
                var stream = liveStreams[i];
                i++;
                if (!stream) {
                    return false;
                }
                $(this).addClass("valid").data("id", stream.id).data("url", stream.url);

                // at least one valid thumb - so the whole LiveStream is valid
                self._isValid = true;
            }).filter(".valid").click(function() {
                var $this = $(this);

                // if clicked on the same active thumb then skip it
                if (!$this.hasClass("inactive")) {
                    return;
                }

               self._showStream($this);
            });
        },

        show: function(streamId) {
            if (!this._isValid)
               return;

            var $thumb = null;
            var $thumbs = this._$comp.find(".liveStreamThumb.valid");
            if (!isDefined(streamId)) {
                $thumb = $thumbs.eq(0);
            } else {
                $thumbs.each(function() {
                    if (streamId === $(this).data("id")) {
                        $thumb = $(this);
                        return false;
                    }
                });
            }

            if (!$thumb) {
                console.warn("No stream for id : " + streamId);
                return;
            }

            this._showStream($thumb);
        },

        /**
         *
         * @return {boolean}
         */
        toggle : function() {
            if (!this._isValid)
                return;

            // if shown hide otherwise show
            if (this._isShown)
                this._hide();
            else
                this.show();

            return this._isShown;
        },

        /* Private Methods */

        _hide : function() {
            var self = this;
            this._$comp.slideUp(undefined, function() {
                // stop the stream when whole panel has completed animation
                self._$comp.find(".liveStreamPlayer").empty();
            });

            this._isShown = false;
        },

        _showStream : function($thumb) {
            // toggle the "inactive" class
            this._$comp.find(".liveStreamThumb").addClass("inactive");
            $thumb.removeClass("inactive");

            // show the new stream
            var url = $thumb.data("url");
            var $player = this._$comp.find(".liveStreamPlayer");
            $player.html('<iframe src=' + url + '?width=640&height=360&autoPlay=true&mute=false" width="490" height="300" frameborder="0" scrolling="no"> </iframe>');

            // show if not already shown
            if (!this._isShown)
                this._$comp.slideDown();
            this._isShown = true;
        }
    }
});