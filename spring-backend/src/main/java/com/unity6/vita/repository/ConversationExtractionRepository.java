package com.unity6.vita.repository;

import com.unity6.vita.entity.ConversationExtraction;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
import java.util.Optional;

public interface ConversationExtractionRepository extends JpaRepository<ConversationExtraction, Long> {

    List<ConversationExtraction> findByProfileIdOrderByExtractedAtDesc(Long profileId);

    Optional<ConversationExtraction> findBySessionId(Long sessionId);

    @Query(value = "SELECT * FROM conversation_extraction WHERE JSON_SEARCH(products, 'one', ?1) IS NOT NULL", nativeQuery = true)
    List<ConversationExtraction> findByProductName(String productName);
}