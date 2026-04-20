package com.unity6.vita.repository;

import com.unity6.vita.entity.InteractionSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface TrainingSessionRepository extends JpaRepository<InteractionSession, Long> {

    List<InteractionSession> findByProfileIdOrderByStartedAtDesc(Long profileId);

    Optional<InteractionSession> findBySessionUuid(String sessionUuid);

    @Modifying
    @Transactional
    @Query("UPDATE InteractionSession ts SET ts.endedAt = ?2 WHERE ts.id = ?1")
    void updateEndTime(Long sessionId, LocalDateTime endedAt);

    long countByMode(String mode);

    List<InteractionSession> findTop10ByOrderByStartedAtDesc();
}