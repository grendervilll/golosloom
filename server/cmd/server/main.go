package main

import (
	"log"
	"net/http"

	"golosloom/server/internal/api"
	"golosloom/server/internal/config"
	"golosloom/server/internal/store"
)

func main() {
	if err := serve(); err != nil {
		log.Fatal(err)
	}
}

func serve() error {
	cfg := config.Load()
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer st.Close()

	srv := api.New(cfg, st)
	httpSrv := &http.Server{Addr: ":" + cfg.Port, Handler: srv.Router()}
	log.Printf("Golosloom server listening on :%s", cfg.Port)
	err = httpSrv.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
