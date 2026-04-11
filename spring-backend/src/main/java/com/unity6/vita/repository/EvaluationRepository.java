package com.unity6.vita.repository;

import com.unity6.vita.entity.Evaluation;
import com.unity6.vita.entity.Profile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface EvaluationRepository extends JpaRepository<Evaluation, Long> {
    List<Evaluation> findByProfile(Profile profile);
    List<Evaluation> findByProfileOrderByDateDesc(Profile profile);
}