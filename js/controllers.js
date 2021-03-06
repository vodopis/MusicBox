angular
    .module("controllers", [])

// Scope.SafeApply (https://github.com/yearofmoo/AngularJS-Scope.SafeApply)
    .run(function ($rootScope) {
        $rootScope.$safeApply = function () {
            var $scope, fn, force = false;
            if (arguments.length == 1) {
                var arg = arguments[0];
                if (typeof arg == 'function') {
                    fn = arg;
                } else {
                    $scope = arg;
                }
            }
            else {
                $scope = arguments[0];
                fn = arguments[1];
                if (arguments.length == 3) {
                    force = !!arguments[2];
                }
            }
            $scope = $scope || this;
            fn = fn || function () {
                };
            if (force || !$scope.$$phase) {
                if ($scope.$apply) $scope.$apply(fn);
                else $scope.apply(fn);
            } else {
                fn();
            }
        };
    })

// Authentication Check
    .run(["$rootScope", "$location", "dropbox", function ($rootScope, $location, dropbox) {
        $rootScope.$on("$locationChangeStart", function (event, next, current) {
            if (!dropbox.isLoggedIn()) {
                if (next.split("#")[1] !== "/login") {
                    $location.path("/login");
                    $rootScope.$safeApply();
                }
            } else if (current.split("#")[1] === "/login") {
                $location.path("/queue");
                $rootScope.$safeApply();
            } else if (next.split("#")[1] === "/login") {
                event.preventDefault(); // Do not allow navigation to login if already logged in.
            }
        });
    }])

    .controller("MainCtrl", ["$rootScope", "$scope", "$location", "dropbox", "library", function ($rootScope, $scope, $location, dropbox, library) {
        if (dropbox.isLoggedIn()) {
            document.body.classList.add("loading");
            $scope.$on("datastore.loaded", function () {
                document.body.classList.remove("loading");
                if (!library.getMusicDirectory()) {
                    library.set("library.musicdirectory", "/ephobe");

                }
                library.scanDropbox();
            });
            $scope.$on("library.loaded", function() {
                $location.path("/songs");
                $rootScope.$safeApply();
            });
        } else {
            $location.path("/login");
        }

        // Playlists
        library.loaded.then(function () {
            $scope.playlists = library.getPlaylists();
            $scope.$safeApply();
            $scope.$on("playlist.change", function () {
                $scope.playlists = library.getPlaylists();
                $scope.$safeApply();
            });
        });

        $scope.dropbox = dropbox;
        $scope.query = "";
        $scope.search = function () {
            $location.path("/search/" + $scope.query);
        };

        $scope.fbRef = new Firebase("https://electrophobic.firebaseIO.com/songs/community-rating");

        $scope.$on("$routeChangeSuccess", function (e, current, previous) {
            if (current.loadedTemplateUrl === "search") {
                $scope.query = current.params.query;
            } else {
                $scope.query = "";
            }
        });

        // Notification Messages
        var notificationTimeoutId;
        $scope.$on("notification", function (e, params) {
            if (notificationTimeoutId) {
                clearTimeout(notificationTimeoutId);
                notificationTimeoutId = undefined;
            }
            $scope.notification = params.message;
            $scope.$safeApply();

            if (!params.sticky) {
                notificationTimeoutId = setTimeout(function () {
                    $scope.notification = "";
                    $scope.$safeApply();
                }, 3000);
            }
        });
    }])

// Login
    .controller("LoginCtrl", ["$scope", "$location", "dropbox", "library", function ($scope, $location, dropbox, library) {
        $scope.login = function () {
            $scope.msg = "Logging In...";
            dropbox.login(function (error) {
                if (error) {
                    console.error(error);
                    $scope.msg = "Login Failed. (" + error + ")";
                } else {
                    $scope.msg = "Login successful! Reticulating Splines now...";
                    if (!library.getMusicDirectory()) {
                        // For the first time login, redirect to Settings page to select their Music Directory.
                        $location.path("/settings");
                    } else {
                        $location.path("/songs");
                        library.scanDropbox();
                    }
                }
                $scope.$safeApply();
            });
        };
    }])

// Logout
    .controller("LogoutCtrl", ["$rootScope", "$scope", "$location", "dropbox", function ($rootScope, $scope, $location, dropbox) {
        dropbox.logout(function () {
            $location.path("/login");
            $rootScope.$safeApply();
        });
    }])

// Settings
    .controller("SettingsCtrl", ["$scope", "$window", "library", "dropbox", "lastfm", "notification",
        function ($scope, $window, library, dropbox, lastfm, notification) {
            $scope.songsCount = library.getSongs().length;
            $scope.lastfmName = lastfm.getName();
            $scope.musicDirectory = library.getMusicDirectory();

            $scope.selectMusicDirectory = function () {
                if (!$scope.firstTime && !$window.confirm("Changing your music directory would reset your library. Continue?")) return;
                $scope.showDirectoryList = true;
                $scope.dirs = undefined;
                dropbox.getRootDirectories(function (err, dirs) {
                    if (err) return console.error(err);
                    dirs.unshift("/"); // Start with root(/) directory which includes the whole Dropbox.
                    $scope.dirs = dirs;
                    $scope.$safeApply();
                });
            };
            $scope.setMusicDirectory = function (dir) {
                $scope.showDirectoryList = false;
                if ($scope.musicDirectory === dir)
                    return notification.message("Please select a different directory."); // Return if the same directory is selected again.

                library.setMusicDirectory(dir);
                library.reset(function () {
                    $scope.musicDirectory = dir;
                    $scope.$safeApply();
                    library.scanDropbox();
                });
            };

            if (!$scope.musicDirectory) {
                $scope.firstTime = true;
                $scope.selectMusicDirectory();
            }

            $scope.scanDropbox = function () {
                library.scanDropbox();
            };
            $scope.resetLibrary = function () {
                if (!$window.confirm("Are you sure you want to reset the music library?")) return;
                $scope.reset_msg = "Resetting...";
                library.reset(function (error) {
                    if (error) {
                        $scope.reset_msg = error;
                    } else {
                        $scope.reset_msg = "Reset Complete! Scan will continue after reloading the page...";
                        location.reload();
                    }
                });
            };
            $scope.lastfmLogin = function () {
                lastfm.login();
            };
            $scope.lastfmLogout = function () {
                if (!$window.confirm("Are you sure?")) return;
                lastfm.logout();
            };
        }])

// Audio Player
    .controller("PlayerCtrl", ["$scope", "queue", "dropbox", "store", "lastfm", "library",
        function ($scope, queue, dropbox, store, lastfm, library) {
            $scope.audio = document.querySelector("audio");
            $scope.seekbar = document.querySelector(".seek");
            $scope.seekbar.value = 0;
            $scope.volume = store.get("volume") || 4;
            $scope.audio.volume = $scope.volume * 0.1;
            $scope.src = "";
            $scope.playing = false;
            $scope.scrobbled = false;

            $scope.play = function () {
                if ($scope.src === "") {
                    queue.nextSong();
                } else {
                    $scope.audio.play();
                    $scope.playing = true;
                    $scope.$safeApply();
                }
            };
            $scope.pause = function () {
                $scope.audio.pause();
                $scope.playing = false;
                $scope.$safeApply();
            };
            $scope.next = function () {
                $scope.pause();
                queue.nextSong();
            };
            $scope.prev = function () {
                $scope.pause();
                queue.previousSong();
            };

            $scope.$on("queue.song.change", function () {
                var song = queue.currentSong();

                console.log("Current Song:", song.get("name"));
                $scope.pause();
                $scope.song = song;
                $scope.src = "";
                $scope.scrobbled = false;

                dropbox.getUrl(song.get('path'), function (error, details) {
                    if (error) {
                        console.error(error);
                        if (error.status === 404) library.removeSong(song); // If the song is missing from DB, remove it from the library.
                        $scope.next(); // If an error occurs while fetching the URL of the song, play the next song.
                        return;
                    }

                    $scope.src = details.url;
                    $scope.$safeApply();
                    $scope.play();
                    if (lastfm.isLoggedIn()) lastfm.nowPlaying($scope.song);
                });
            });
            $scope.$on("queue.end", function () {
                $scope.pause();
                $scope.src = "";
                $scope.scrobbled = false;
                $scope.progress = 0;
                $scope.song = undefined;
                $scope.$safeApply();
            });

            $scope.audio.addEventListener("canplay", function () {
                $scope.seekbar.min = 0;
                $scope.seekbar.max = $scope.audio.duration;
            }, false);
            $scope.audio.addEventListener("ended", function () {
                $scope.next(); // When audio ends, play the next song.
            }, false);
            $scope.audio.addEventListener("error", function () {
                $scope.next(); // If an error occurs while playing the song, play the next song.
            }, false);
            $scope.audio.addEventListener("timeupdate", function () {
                $scope.seekbar.value = $scope.audio.currentTime;
                $scope.progress = ($scope.audio.currentTime / $scope.audio.duration) * 100;

                // Scrobble to Last.fm if song has been played for at least half its duration, or for 4 minutes.
                if (lastfm.isLoggedIn() && $scope.playing && !$scope.scrobbled && ($scope.progress > 50 || $scope.audio.currentTime > 240)) {
                    $scope.scrobbled = true;
                    lastfm.scrobble($scope.song);
                }
                $scope.$safeApply();
            }, false);
            $scope.seekbar.addEventListener("change", function () {
                $scope.audio.currentTime = $scope.seekbar.value;
            });

            document.addEventListener("keypress", function (e) {
                if (e.target.classList.contains("search-box")) return;
                if (e.keyCode == 32) {
                    if ($scope.audio.paused) $scope.play();
                    else $scope.pause();
                } else if (e.keyCode == 37) {
                    queue.previousSong();
                } else if (e.keyCode == 39) {
                    queue.nextSong();
                }
            }, false);
            document.querySelector(".volume").addEventListener("click", function (e) {
                if (!e.target.classList.contains("bar")) return;
                $scope.volume = e.target.dataset.value;
                $scope.audio.volume = $scope.volume * 0.1;
                store.set("volume", $scope.volume);
                $scope.$safeApply();
            });
        }])

// Songs
    .controller("SongsListCtrl", ["$scope", "library", function($scope, library) {
        $scope.songs = library.getSongs();


        angular.forEach($scope.songs, function(song) {
            var filteredSongPath = song.get('path').replace(/\.|\[|\]|\#|\$/g, '_');
            $scope.fbRef.child(filteredSongPath).once('value', function (snap) {
                var communityRating = snap.val();
                if (! angular.isUndefined(communityRating) && communityRating !== null) {
                    console.log("community rating exists for song: " + filteredSongPath + ", :: " + JSON.stringify(communityRating) );
                    song.set("communityRating", communityRating.rating);
                }
            });
        });
    }])

    .controller("SongsCtrl", ["$scope", "$http", "$window", "queue", "library", "notification",
        function ($scope, $http, $window, queue, library, notification) {
            $scope.predicate = "modifiedMillis";
            $scope.sortReverse = true;

            $scope.updateRating = function (song, newUserRating) {
                var oldUserRating = song.get("userRating");

                oldUserRating = parseInt(oldUserRating, 10);
                newUserRating = parseInt(newUserRating, 10);

                if (! angular.isUndefined(oldUserRating) && newUserRating == parseInt(oldUserRating)) {
                    console.log("user ratings match");
                    return false;
                }

                var filteredSongPath = song.get('path').replace(/\.|\[|\]|\#|\$/g, '_');
                $scope.fbRef.child(filteredSongPath).once('value', function (snap) {
                    var communityRating = snap.val();
                    //console.log("existing community rating: " + JSON.stringify(communityRating));

                    if (angular.isUndefined(communityRating) || communityRating == null) {
                        communityRating = {};
                        communityRating.rating = newUserRating;
                        communityRating.votes = 1;
                    }
                    else {
                        communityRating.rating = parseFloat(communityRating.rating, 10);
                        communityRating.votes = parseInt(communityRating.votes, 10);

                        var oldTotal = communityRating.rating * communityRating.votes;
                        var newTotal = (angular.isUndefined(oldUserRating) || oldUserRating == null || !oldUserRating) ? (oldTotal + newUserRating) : (oldTotal - oldUserRating + newUserRating);

                        communityRating.votes = (angular.isUndefined(oldUserRating) || oldUserRating == null || !oldUserRating) ? communityRating.votes + 1 : communityRating.votes;
                        communityRating.rating = newTotal / communityRating.votes;

                    }
                    // save to Firebase
                    console.log("saving rating to FB: " + JSON.stringify(communityRating));
                    $scope.fbRef.child(filteredSongPath).set(communityRating);

                    song.set("userRating", newUserRating.toString());
                    song.set("communityRating", communityRating.rating);

                    notification.message("Rating saved.");

                });
            };

            $scope.play = function (songs, index) {
                queue.clear();
                queue.add(songs, index);
            };

            $scope.download = function (song) {
                for (var key in localStorage) {
                    if (key.indexOf("dropbox-auth") === 0) {
                        var auth = JSON.parse(localStorage[key]);
                        var token = auth.token;
                    }
                }

                if (auth.token) {
                    $http({
                        method: 'POST',
                        url: 'https://api.dropbox.com/1/media/auto/' + song.get('path'),
                        headers: {'Authorization': 'Bearer ' + auth.token}
                    }).
                        success(function (data, status, headers, config) {
                            location.href = data.url + "?dl=1";

                        }).
                        error(function (data, status, headers, config) {
                            console.log("failed to get download url");
                        });
                }

            };
            $scope.addToPlaylist = function (playlist, song) {
                var playlistName;
                if (!playlist.get) {
                    playlistName = $window.prompt("New Playlist Name");
                    if (!playlistName) return notification.message("Invalid Name!");
                } else {
                    playlistName = playlist.get("name");
                }
                if (playlistName === "Queue") queue.add([song]);
                else library.addToPlaylist(playlistName, [song]);
                notification.message("Added to " + playlistName);
            };
        }])


// Playlists
    .controller("PlaylistCtrl", ["$scope", "$location", "$routeParams", "$window", "library", "queue",
        function ($scope, $location, $routeParams, $window, library, queue) {
            console.log("playlist controller called");
            $scope.songs = library.getPlaylist($routeParams.name);
            $scope.name = $routeParams.name;

            $scope.addToQueue = function (songs) {
                queue.add(songs);
            };
            $scope.clear = function () {
                if (!$window.confirm("Are you sure?")) return;
                $scope.songs = [];
                if ($scope.name === "Queue") queue.clear();
                else library.clearPlaylist($scope.name);
            };
            $scope.deletePlaylist = function () {
                if (!$window.confirm("Are you sure?")) return;
                $scope.songs = [];
                library.deletePlaylist($scope.name);
                $location.path("/playlist/Queue");
                $scope.$safeApply();
            };

            // Highlight the now playing song in 'Queue' Playlist
            if ($scope.name === 'Queue') {
                $scope.nowPlaying = queue.index();
                $scope.$on("queue.song.change", function () {
                    $scope.nowPlaying = queue.index();
                    $scope.$safeApply();
                });
            }
        }])

// Search
    .controller("SearchCtrl", ["$scope", "$routeParams", "$filter", "library", function ($scope, $routeParams, $filter, library) {
        $scope.songs = $filter("song")(library.getSongs(), $routeParams.query);
        $scope.albums = $filter("name")(library.getAlbums(), $routeParams.query);
        $scope.artists = $filter("name")(library.getArtists(), $routeParams.query);
    }])

//Albums
    .controller("AlbumsListCtrl", ["$scope", "library", function ($scope, library) {
        $scope.albums = library.getAlbums();
    }])
    .controller("AlbumsShowCtrl", ["$scope", "$routeParams", "library", "queue", function ($scope, $routeParams, library, queue) {
        $scope.album = library.getAlbums({name: $routeParams.album, artist: $routeParams.artist})[0];
        $scope.songs = library.getSongs({album: $routeParams.album, artist: $routeParams.artist});
    }])

// Artists
    .controller("ArtistsListCtrl", ["$scope", "library", function ($scope, library) {
        $scope.artists = library.getArtists();
    }])
    .controller("ArtistsShowCtrl", ["$scope", "$routeParams", "library", function ($scope, $routeParams, library) {
        $scope.artist = library.getArtists({name: $routeParams.artist})[0];
        $scope.albums = library.getAlbums({artist: $routeParams.artist});
        $scope.songs = library.getSongs({artist: $routeParams.artist});
    }])
    .controller("ArtistsMixtapeCtrl", ["$scope", "$routeParams", "library", function ($scope, $routeParams, library) {
        $scope.artist = library.getArtists({name: $routeParams.artist})[0];
        $scope.songs = library.createMixtape($routeParams.artist);

        $scope.songs.then(function () {
            $scope.loaded = true;
            $scope.$safeApply();
        });
    }])

// Genres
    .controller("GenresListCtrl", ["$scope", "library", function ($scope, library) {
        $scope.genres = library.getGenres();
        $scope.albums = [];
        angular.forEach($scope.genres, function (genre) {
            angular.forEach(library.getAlbums({genre: genre.get("name")}), function (album) {
                if (!$scope.albums[genre.get("name")]) $scope.albums[genre.get("name")] = [];
                if ($scope.albums[genre.get("name")].length === 5 || !album.get("image")) return;
                $scope.albums[genre.get("name")].push(album);
            });
        });
    }])
    .controller("GenresShowCtrl", ["$scope", "$routeParams", "library", function ($scope, $routeParams, library) {
        $scope.genre = library.getGenres({name: $routeParams.genre})[0];
        $scope.albums = library.getAlbums({genre: $routeParams.genre});
        $scope.songs = library.getSongs({genre: $routeParams.genre});
    }]);
