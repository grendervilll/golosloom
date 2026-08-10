// Мониторинг системы для админ-панели: процент использования CPU и RAM
// (Linux — /proc; на других ОС возвращаем 0 — локальная разработка).
package api

import (
	"bufio"
	"os"
	"runtime"
	"strconv"
	"strings"
)

// systemCPUPercent возвращает средний процент использования CPU с момента
// предыдущего вызова (дельта по /proc/stat). Первый вызов — 0.
func (s *Server) systemCPUPercent() float64 {
	if runtime.GOOS != "linux" {
		return 0
	}
	idle, total := readCPUTimes()
	if total == 0 {
		return 0
	}
	s.statsMu.Lock()
	defer s.statsMu.Unlock()
	if s.prevCPUTotal == 0 {
		s.prevCPUIdle, s.prevCPUTotal = idle, total
		return 0
	}
	dIdle := idle - s.prevCPUIdle
	dTotal := total - s.prevCPUTotal
	s.prevCPUIdle, s.prevCPUTotal = idle, total
	if dTotal == 0 {
		return 0
	}
	used := 1 - float64(dIdle)/float64(dTotal)
	if used < 0 {
		used = 0
	}
	if used > 1 {
		used = 1
	}
	return used * 100
}

// readCPUTimes читает суммарные тики CPU из /proc/stat (idle = idle + iowait).
func readCPUTimes() (idle, total uint64) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)[1:]
		for i, fv := range fields {
			v, _ := strconv.ParseUint(fv, 10, 64)
			total += v
			if i == 3 || i == 4 { // idle + iowait
				idle += v
			}
		}
		return idle, total
	}
	return 0, 0
}

// systemRAM возвращает занятый процент RAM и общий объём в МБ (Linux).
func systemRAM() (usedPercent float64, totalMB int64) {
	if runtime.GOOS != "linux" {
		return 0, 0
	}
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	var totalKb, availKb int64
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "MemTotal:"):
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				totalKb, _ = strconv.ParseInt(fields[1], 10, 64)
			}
		case strings.HasPrefix(line, "MemAvailable:"):
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				availKb, _ = strconv.ParseInt(fields[1], 10, 64)
			}
		}
		if totalKb > 0 && availKb > 0 {
			break
		}
	}
	if totalKb <= 0 {
		return 0, 0
	}
	used := float64(totalKb-availKb) / float64(totalKb) * 100
	if used < 0 {
		used = 0
	}
	return used, totalKb / 1024
}
